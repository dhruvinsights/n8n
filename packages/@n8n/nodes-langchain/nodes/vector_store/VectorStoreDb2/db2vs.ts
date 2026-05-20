/**
 * DB2 Vector Store Implementation
 * Implements LangChain VectorStore interface for IBM DB2 with vector search capabilities
 */

import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { VectorStore } from '@langchain/core/vectorstores';
import { Document } from '@langchain/core/documents';
import { maximalMarginalRelevance } from '@langchain/core/utils/math';
import { jsonParse } from 'n8n-workflow';
import {
	validateIdentifier,
	getQuotedIdentifier,
	sanitizeSqlString,
	createSafeErrorMessage,
} from './db2-security';

export interface Db2ConnectionParams {
	database: string;
	hostname: string;
	port: number;
	username: string;
	password: string;
}

export interface Db2VectorStoreConfig {
	connectionParams: Db2ConnectionParams;
	tableName: string;
	textColumnName?: string;
	embeddingColumnName?: string;
	metadataColumnName?: string;
	idColumnName?: string;
	distanceStrategy?: 'COSINE' | 'EUCLIDEAN_DISTANCE' | 'DOT_PRODUCT';
}

export type DistanceStrategy = 'COSINE' | 'EUCLIDEAN_DISTANCE' | 'DOT_PRODUCT';

/**
 * DB2 Vector Store class
 * Provides vector similarity search using IBM DB2's vector search capabilities
 */
export class DB2VectorStore extends VectorStore {
	private connection: any = null;

	private readonly connectionParams: Db2ConnectionParams;

	private readonly tableName: string;

	private readonly textColumnName: string;

	private readonly embeddingColumnName: string;

	private readonly metadataColumnName: string;

	private readonly idColumnName: string;

	private readonly distanceStrategy: DistanceStrategy;

	private embeddingDimension: number | null = null;

	filter?: Record<string, unknown>;

	declare FilterType: Record<string, unknown>;

	constructor(embeddings: EmbeddingsInterface, config: Db2VectorStoreConfig) {
		super(embeddings, config);

		// Validate table name
		if (!validateIdentifier(config.tableName)) {
			throw new Error(`Invalid table name: ${config.tableName}`);
		}

		this.connectionParams = config.connectionParams;
		this.tableName = config.tableName;
		this.textColumnName = config.textColumnName ?? 'text';
		this.embeddingColumnName = config.embeddingColumnName ?? 'embedding';
		this.metadataColumnName = config.metadataColumnName ?? 'metadata';
		this.idColumnName = config.idColumnName ?? 'id';
		this.distanceStrategy = config.distanceStrategy ?? 'COSINE';

		// Validate all column names
		[
			this.textColumnName,
			this.embeddingColumnName,
			this.metadataColumnName,
			this.idColumnName,
		].forEach((col) => {
			if (!validateIdentifier(col)) {
				throw new Error(`Invalid column name: ${col}`);
			}
		});
	}

	/**
	 * Gets or creates a DB2 connection
	 */
	private async getConnection(): Promise<any> {
		if (this.connection) {
			return this.connection;
		}

		try {
			// Dynamic import of ibm_db - will be mocked in tests
			const ibmDb = await import('ibm_db');

			const connStr = `DATABASE=${this.connectionParams.database};HOSTNAME=${this.connectionParams.hostname};PORT=${this.connectionParams.port};PROTOCOL=TCPIP;UID=${this.connectionParams.username};PWD=${this.connectionParams.password};`;

			this.connection = await new Promise((resolve, reject) => {
				ibmDb.open(connStr, (err: Error | null, conn: any) => {
					if (err) {
						reject(new Error(`DB2 connection failed: ${createSafeErrorMessage(err)}`));
					} else {
						resolve(conn);
					}
				});
			});

			return this.connection;
		} catch (error) {
			throw new Error(`Failed to connect to DB2: ${createSafeErrorMessage(error)}`);
		}
	}

	/**
	 * Executes a SQL query
	 */
	private async executeQuery(sql: string, params: any[] = []): Promise<any[]> {
		const conn = await this.getConnection();

		return await new Promise((resolve, reject) => {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
			conn.query(sql, params, (err: Error | null, result: any[]) => {
				if (err) {
					reject(new Error(`Query execution failed: ${createSafeErrorMessage(err)}`));
				} else {
					resolve(result || []);
				}
			});
		});
	}

	/**
	 * Checks if table exists
	 */
	private async tableExists(): Promise<boolean> {
		try {
			const sql = 'SELECT 1 FROM SYSCAT.TABLES WHERE TABNAME = ? LIMIT 1';
			const result = await this.executeQuery(sql, [this.tableName.toUpperCase()]);
			return result.length > 0;
		} catch (error) {
			return false;
		}
	}

	/**
	 * Creates the vector store table if it doesn't exist
	 */
	private async createTable(dimension: number): Promise<void> {
		const exists = await this.tableExists();
		if (exists) {
			return;
		}

		const quotedTable = getQuotedIdentifier(this.tableName);
		const quotedId = getQuotedIdentifier(this.idColumnName);
		const quotedText = getQuotedIdentifier(this.textColumnName);
		const quotedEmbedding = getQuotedIdentifier(this.embeddingColumnName);
		const quotedMetadata = getQuotedIdentifier(this.metadataColumnName);

		const sql = `
			CREATE TABLE ${quotedTable} (
				${quotedId} VARCHAR(255) NOT NULL PRIMARY KEY,
				${quotedText} CLOB,
				${quotedEmbedding} VECTOR(${dimension}),
				${quotedMetadata} CLOB
			)
		`;

		await this.executeQuery(sql);
	}

	/**
	 * Adds texts with embeddings to the vector store
	 */
	async addVectors(
		vectors: number[][],
		documents: Document[],
		options?: { ids?: string[] },
	): Promise<string[]> {
		if (vectors.length === 0) {
			return [];
		}

		// Validate embedding dimensions
		const dimension = vectors[0].length;
		if (this.embeddingDimension === null) {
			this.embeddingDimension = dimension;
		} else if (this.embeddingDimension !== dimension) {
			throw new Error(
				`Embedding dimension mismatch. Expected ${this.embeddingDimension}, got ${dimension}`,
			);
		}

		// Ensure table exists
		await this.createTable(dimension);

		const ids = options?.ids ?? documents.map(() => this.generateId());

		const quotedTable = getQuotedIdentifier(this.tableName);
		const quotedId = getQuotedIdentifier(this.idColumnName);
		const quotedText = getQuotedIdentifier(this.textColumnName);
		const quotedEmbedding = getQuotedIdentifier(this.embeddingColumnName);
		const quotedMetadata = getQuotedIdentifier(this.metadataColumnName);

		// Insert documents in batches
		for (let i = 0; i < vectors.length; i++) {
			const id = ids[i];
			const text = documents[i].pageContent;
			const metadata = JSON.stringify(documents[i].metadata || {});
			const embedding = `[${vectors[i].join(',')}]`;

			const sql = `
				INSERT INTO ${quotedTable} (${quotedId}, ${quotedText}, ${quotedEmbedding}, ${quotedMetadata})
				VALUES (?, ?, VECTOR(?), ?)
			`;

			await this.executeQuery(sql, [id, text, embedding, metadata]);
		}

		return ids;
	}

	/**
	 * Adds documents to the vector store
	 */
	async addDocuments(documents: Document[], options?: { ids?: string[] }): Promise<string[]> {
		const texts = documents.map((doc) => doc.pageContent);
		return await this.addTexts(
			texts,
			documents.map((doc) => doc.metadata),
			options,
		);
	}

	/**
	 * Adds texts to the vector store
	 */
	async addTexts(
		texts: string[],
		metadatas?: Array<Record<string, unknown>> | Record<string, unknown>,
		options?: { ids?: string[] },
	): Promise<string[]> {
		const embeddings = await this.embeddings.embedDocuments(texts);

		const documents = texts.map((text, i) => ({
			pageContent: text,
			metadata: Array.isArray(metadatas) ? metadatas[i] : metadatas || {},
		}));

		return await this.addVectors(embeddings, documents, options);
	}

	/**
	 * Performs similarity search with scores
	 */
	async similaritySearchVectorWithScore(
		query: number[],
		k: number,
		filter?: this['FilterType'],
	): Promise<Array<[Document, number]>> {
		const quotedTable = getQuotedIdentifier(this.tableName);
		const quotedId = getQuotedIdentifier(this.idColumnName);
		const quotedText = getQuotedIdentifier(this.textColumnName);
		const quotedEmbedding = getQuotedIdentifier(this.embeddingColumnName);
		const quotedMetadata = getQuotedIdentifier(this.metadataColumnName);

		const queryVector = `[${query.join(',')}]`;

		let distanceFunction: string;
		switch (this.distanceStrategy) {
			case 'COSINE':
				distanceFunction = `COSINE_DISTANCE(${quotedEmbedding}, VECTOR(?))`;
				break;
			case 'EUCLIDEAN_DISTANCE':
				distanceFunction = `EUCLIDEAN_DISTANCE(${quotedEmbedding}, VECTOR(?))`;
				break;
			case 'DOT_PRODUCT':
				distanceFunction = `INNER_PRODUCT(${quotedEmbedding}, VECTOR(?))`;
				break;
			default:
				distanceFunction = `COSINE_DISTANCE(${quotedEmbedding}, VECTOR(?))`;
		}

		let sql = `
			SELECT ${quotedId}, ${quotedText}, ${quotedMetadata}, ${distanceFunction} as distance
			FROM ${quotedTable}
		`;

		const params: any[] = [queryVector];

		// Add filter conditions if provided
		if (filter && Object.keys(filter).length > 0) {
			const conditions: string[] = [];
			for (const [key, value] of Object.entries(filter)) {
				conditions.push(`JSON_VALUE(${quotedMetadata}, '$.${sanitizeSqlString(key)}') = ?`);
				params.push(String(value));
			}
			sql += ` WHERE ${conditions.join(' AND ')}`;
		}

		sql += ` ORDER BY distance ASC FETCH FIRST ${k} ROWS ONLY`;

		const results = await this.executeQuery(sql, params);

		return results.map((row: any) => {
			const metadataStr = row[this.metadataColumnName.toUpperCase()];
			const metadata = metadataStr ? jsonParse<Record<string, unknown>>(metadataStr) : {};

			const doc = new Document({
				pageContent: row[this.textColumnName.toUpperCase()] || '',
				metadata,
			});

			return [doc, row.DISTANCE];
		});
	}

	/**
	 * Performs similarity search
	 */
	async similaritySearch(query: string, k = 4, filter?: this['FilterType']): Promise<Document[]> {
		const results = await this.similaritySearchWithScore(query, k, filter);
		return results.map((result) => result[0]);
	}

	/**
	 * Performs similarity search with scores
	 */
	async similaritySearchWithScore(
		query: string,
		k = 4,
		filter?: this['FilterType'],
	): Promise<Array<[Document, number]>> {
		const queryEmbedding = await this.embeddings.embedQuery(query);
		return await this.similaritySearchVectorWithScore(queryEmbedding, k, filter);
	}

	/**
	 * Performs maximal marginal relevance search
	 */
	async maximalMarginalRelevanceSearch(
		query: string,
		options: {
			k: number;
			fetchK?: number;
			lambda?: number;
			filter?: Record<string, unknown>;
		},
	): Promise<Document[]> {
		const queryEmbedding = await this.embeddings.embedQuery(query);
		return await this.maximalMarginalRelevanceSearchByVector(queryEmbedding, options);
	}

	/**
	 * Performs maximal marginal relevance search by vector
	 */
	async maximalMarginalRelevanceSearchByVector(
		queryEmbedding: number[],
		options: {
			k: number;
			fetchK?: number;
			lambda?: number;
			filter?: Record<string, unknown>;
		},
	): Promise<Document[]> {
		const { k, fetchK = 20, lambda = 0.5, filter } = options;

		// Fetch more documents than needed
		const results = await this.similaritySearchVectorWithScore(queryEmbedding, fetchK, filter);

		if (results.length === 0) {
			return [];
		}

		const embeddings = await Promise.all(
			results.map(async ([doc]) => {
				// Re-embed the document text to get its embedding
				return await this.embeddings.embedQuery(doc.pageContent);
			}),
		);

		// Use MMR algorithm to select diverse results
		const mmrIndexes = maximalMarginalRelevance(queryEmbedding, embeddings, lambda, k);

		return mmrIndexes.map((idx) => results[idx][0]);
	}

	/**
	 * Deletes documents by IDs
	 */
	async delete(params: { ids: string[] }): Promise<void> {
		if (!params.ids || params.ids.length === 0) {
			return;
		}

		const quotedTable = getQuotedIdentifier(this.tableName);
		const quotedId = getQuotedIdentifier(this.idColumnName);

		const placeholders = params.ids.map(() => '?').join(',');
		const sql = `DELETE FROM ${quotedTable} WHERE ${quotedId} IN (${placeholders})`;

		await this.executeQuery(sql, params.ids);
	}

	/**
	 * Updates documents with empty embeddings
	 */
	async updateEmptyEmbeddings(): Promise<number> {
		const quotedTable = getQuotedIdentifier(this.tableName);
		const quotedId = getQuotedIdentifier(this.idColumnName);
		const quotedText = getQuotedIdentifier(this.textColumnName);
		const quotedEmbedding = getQuotedIdentifier(this.embeddingColumnName);

		// Find documents with NULL embeddings
		const sql = `SELECT ${quotedId}, ${quotedText} FROM ${quotedTable} WHERE ${quotedEmbedding} IS NULL`;
		const results = await this.executeQuery(sql);

		if (results.length === 0) {
			return 0;
		}

		// Generate embeddings for texts
		const texts = results.map((row: any) => row[this.textColumnName.toUpperCase()] || '');
		const embeddings = await this.embeddings.embedDocuments(texts);

		// Update each document
		const updateSql = `UPDATE ${quotedTable} SET ${quotedEmbedding} = VECTOR(?) WHERE ${quotedId} = ?`;

		for (let i = 0; i < results.length; i++) {
			const id = results[i][this.idColumnName.toUpperCase()];
			const embedding = `[${embeddings[i].join(',')}]`;
			await this.executeQuery(updateSql, [embedding, id]);
		}

		return results.length;
	}

	/**
	 * Creates a DB2VectorStore from texts
	 */
	static async fromTexts(
		texts: string[],
		metadatas: Array<Record<string, unknown>> | Record<string, unknown>,
		embeddings: EmbeddingsInterface,
		dbConfig: Db2VectorStoreConfig,
	): Promise<DB2VectorStore> {
		const instance = new DB2VectorStore(embeddings, dbConfig);
		await instance.addTexts(texts, metadatas);
		return instance;
	}

	/**
	 * Creates a DB2VectorStore from documents
	 */
	static async fromDocuments(
		docs: Document[],
		embeddings: EmbeddingsInterface,
		dbConfig: Db2VectorStoreConfig,
	): Promise<DB2VectorStore> {
		const instance = new DB2VectorStore(embeddings, dbConfig);
		await instance.addDocuments(docs);
		return instance;
	}

	/**
	 * Creates a DB2VectorStore from an existing collection
	 */
	static async fromExistingTable(
		embeddings: EmbeddingsInterface,
		dbConfig: Db2VectorStoreConfig,
	): Promise<DB2VectorStore> {
		const instance = new DB2VectorStore(embeddings, dbConfig);

		// Verify table exists
		const exists = await instance.tableExists();
		if (!exists) {
			throw new Error(`Table ${dbConfig.tableName} does not exist`);
		}

		return instance;
	}

	/**
	 * Generates a unique ID
	 */
	private generateId(): string {
		return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
	}

	/**
	 * Closes the database connection
	 */
	async close(): Promise<void> {
		if (this.connection) {
			await new Promise<void>((resolve, reject) => {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
				this.connection.close((err: Error | null) => {
					if (err) {
						reject(err);
					} else {
						resolve();
					}
				});
			});
			this.connection = null;
		}
	}

	_vectorstoreType(): string {
		return 'db2';
	}
}

// Made with Bob
