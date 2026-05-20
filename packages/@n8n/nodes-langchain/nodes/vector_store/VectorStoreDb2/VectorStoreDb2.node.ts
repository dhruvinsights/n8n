import type {
	INodeProperties,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	ISupplyDataFunctions,
} from 'n8n-workflow';
import { NodeOperationError, NodeApiError } from 'n8n-workflow';

import { metadataFilterField, createVectorStoreNode } from '@n8n/ai-utilities';

import { DB2VectorStore } from './db2vs';
import type { Db2ConnectionParams, Db2VectorStoreConfig } from './db2vs';
import {
	validateConnectionConfig,
	validateIdentifier,
	createSafeErrorMessage,
} from './db2-security';

const db2TableRLC: INodeProperties = {
	displayName: 'Table Name',
	name: 'db2Table',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: {
				searchListMethod: 'db2TablesSearch',
			},
		},
		{
			displayName: 'ID',
			name: 'id',
			type: 'string',
			validation: [
				{
					type: 'regex',
					properties: {
						regex: '^[A-Za-z_][A-Za-z0-9_]{0,127}$',
						errorMessage:
							'Invalid table name. Must be 1-128 alphanumeric characters starting with letter or underscore.',
					},
				},
			],
		},
	],
};

const sharedFields: INodeProperties[] = [db2TableRLC];

const insertFields: INodeProperties[] = [
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		options: [
			{
				displayName: 'Clear Table',
				name: 'clearTable',
				type: 'boolean',
				default: false,
				description: 'Whether to clear the table before inserting new data',
			},
			{
				displayName: 'Text Column Name',
				name: 'textColumnName',
				type: 'string',
				default: 'text',
				description: 'Name of the column to store document text',
			},
			{
				displayName: 'Embedding Column Name',
				name: 'embeddingColumnName',
				type: 'string',
				default: 'embedding',
				description: 'Name of the column to store embeddings',
			},
			{
				displayName: 'Metadata Column Name',
				name: 'metadataColumnName',
				type: 'string',
				default: 'metadata',
				description: 'Name of the column to store metadata',
			},
			{
				displayName: 'ID Column Name',
				name: 'idColumnName',
				type: 'string',
				default: 'id',
				description: 'Name of the column to store document IDs',
			},
		],
	},
];

const retrieveFields: INodeProperties[] = [
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		options: [
			metadataFilterField,
			{
				displayName: 'Distance Strategy',
				name: 'distanceStrategy',
				type: 'options',
				default: 'COSINE',
				description: 'The method to calculate the distance between two vectors',
				options: [
					{
						name: 'Cosine',
						value: 'COSINE',
						description: 'Cosine similarity (recommended for most use cases)',
					},
					{
						name: 'Euclidean Distance',
						value: 'EUCLIDEAN_DISTANCE',
						description: 'Euclidean distance between vectors',
					},
					{
						name: 'Dot Product',
						value: 'DOT_PRODUCT',
						description: 'Inner product of vectors',
					},
				],
			},
			{
				displayName: 'Text Column Name',
				name: 'textColumnName',
				type: 'string',
				default: 'text',
				description: 'Name of the column storing document text',
			},
			{
				displayName: 'Embedding Column Name',
				name: 'embeddingColumnName',
				type: 'string',
				default: 'embedding',
				description: 'Name of the column storing embeddings',
			},
			{
				displayName: 'Metadata Column Name',
				name: 'metadataColumnName',
				type: 'string',
				default: 'metadata',
				description: 'Name of the column storing metadata',
			},
			{
				displayName: 'ID Column Name',
				name: 'idColumnName',
				type: 'string',
				default: 'id',
				description: 'Name of the column storing document IDs',
			},
		],
	},
];

/**
 * Gets DB2 connection parameters from credentials
 */
async function getDb2ConnectionParams(
	context: IExecuteFunctions | ILoadOptionsFunctions | ISupplyDataFunctions,
	itemIndex?: number,
): Promise<Db2ConnectionParams> {
	const credentials = await context.getCredentials('db2Api', itemIndex);

	const connectionParams: Db2ConnectionParams = {
		database: credentials.database as string,
		hostname: credentials.host as string,
		port: credentials.port as number,
		username: credentials.user as string,
		password: credentials.password as string,
	};

	// Validate connection configuration
	const validation = validateConnectionConfig(connectionParams);
	if (!validation.valid) {
		throw new NodeOperationError(
			context.getNode(),
			`Invalid DB2 connection configuration: ${validation.errors.join(', ')}`,
		);
	}

	return connectionParams;
}

/**
 * Gets DB2 vector store configuration
 */
async function getDb2Config(
	context: IExecuteFunctions | ILoadOptionsFunctions | ISupplyDataFunctions,
	itemIndex: number,
): Promise<Db2VectorStoreConfig> {
	const tableName = context.getNodeParameter('db2Table', itemIndex, '', {
		extractValue: true,
	}) as string;

	if (!validateIdentifier(tableName)) {
		throw new NodeOperationError(
			context.getNode(),
			`Invalid table name: ${tableName}. Must be 1-128 alphanumeric characters starting with letter or underscore.`,
		);
	}

	const connectionParams = await getDb2ConnectionParams(context, itemIndex);

	const options = context.getNodeParameter('options', itemIndex, {}) as {
		textColumnName?: string;
		embeddingColumnName?: string;
		metadataColumnName?: string;
		idColumnName?: string;
		distanceStrategy?: 'COSINE' | 'EUCLIDEAN_DISTANCE' | 'DOT_PRODUCT';
	};

	return {
		connectionParams,
		tableName,
		textColumnName: options.textColumnName,
		embeddingColumnName: options.embeddingColumnName,
		metadataColumnName: options.metadataColumnName,
		idColumnName: options.idColumnName,
		distanceStrategy: options.distanceStrategy,
	};
}

export class VectorStoreDb2 extends createVectorStoreNode<DB2VectorStore>({
	meta: {
		displayName: 'DB2 Vector Store',
		name: 'vectorStoreDb2',
		description: 'Work with your data in IBM DB2 Vector Store',
		icon: { light: 'file:db2.svg', dark: 'file:db2.svg' },
		docsUrl:
			'https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.vectorstoredb2/',
		credentials: [
			{
				name: 'db2Api',
				required: true,
			},
		],
		operationModes: ['load', 'insert', 'retrieve', 'retrieve-as-tool'],
	},
	methods: {
		listSearch: {
			async db2TablesSearch(this: ILoadOptionsFunctions) {
				try {
					const connectionParams = await getDb2ConnectionParams(this);

					// Dynamic import of ibm_db
					const ibmDb = await import('ibm_db');

					const connStr = `DATABASE=${connectionParams.database};HOSTNAME=${connectionParams.hostname};PORT=${connectionParams.port};PROTOCOL=TCPIP;UID=${connectionParams.username};PWD=${connectionParams.password};`;

					const conn = await new Promise<any>((resolve, reject) => {
						ibmDb.open(connStr, (err: Error | null, connection: any) => {
							if (err) {
								reject(err);
							} else {
								resolve(connection);
							}
						});
					});

					try {
						const sql =
							"SELECT TABNAME FROM SYSCAT.TABLES WHERE TABSCHEMA = CURRENT SCHEMA AND TYPE = 'T' ORDER BY TABNAME";

						const tables = await new Promise<any[]>((resolve, reject) => {
							conn.query(sql, (err: Error | null, result: any[]) => {
								if (err) {
									reject(err);
								} else {
									resolve(result || []);
								}
							});
						});

						const results = tables.map((table: any) => ({
							name: table.TABNAME,
							value: table.TABNAME,
						}));

						return { results };
					} finally {
						await new Promise<void>((resolve, reject) => {
							conn.close((err: Error | null) => {
								if (err) {
									reject(err);
								} else {
									resolve();
								}
							});
						});
					}
				} catch (error) {
					const errorMessage = createSafeErrorMessage(error);

					// Check for connection errors
					if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('Failed to connect')) {
						throw new NodeApiError(this.getNode(), {
							message:
								'Cannot connect to DB2. Please ensure DB2 is running and accessible at the configured host and port.',
						});
					}

					// Check for authentication errors
					if (
						errorMessage.includes('authentication') ||
						errorMessage.includes('SQL30082N') ||
						errorMessage.includes('password')
					) {
						throw new NodeApiError(this.getNode(), {
							message:
								'Authentication failed. Please check your username and password in the credentials.',
						});
					}

					throw new NodeApiError(this.getNode(), {
						message: `Failed to list DB2 tables: ${errorMessage}`,
					});
				}
			},
		},
	},
	sharedFields,
	insertFields,
	loadFields: retrieveFields,
	retrieveFields,

	async getVectorStoreClient(context, filter, embeddings, itemIndex) {
		const config = await getDb2Config(context, itemIndex);

		try {
			const vectorStore = await DB2VectorStore.fromExistingTable(embeddings, config);

			// Apply filter if provided
			if (filter && Object.keys(filter).length > 0) {
				vectorStore.filter = filter;
			}

			return vectorStore;
		} catch (error) {
			const message = createSafeErrorMessage(error);
			throw new NodeOperationError(context.getNode(), `Error connecting to DB2: ${message}`, {
				itemIndex,
			});
		}
	},

	async populateVectorStore(context, embeddings, documents, itemIndex) {
		const config = await getDb2Config(context, itemIndex);
		const options = context.getNodeParameter('options', itemIndex, {}) as {
			clearTable?: boolean;
		};

		const clearTable = options.clearTable === true;

		if (clearTable) {
			try {
				const connectionParams = await getDb2ConnectionParams(context, itemIndex);

				// Dynamic import of ibm_db
				const ibmDb = await import('ibm_db');

				const connStr = `DATABASE=${connectionParams.database};HOSTNAME=${connectionParams.hostname};PORT=${connectionParams.port};PROTOCOL=TCPIP;UID=${connectionParams.username};PWD=${connectionParams.password};`;

				const conn = await new Promise<any>((resolve, reject) => {
					ibmDb.open(connStr, (err: Error | null, connection: any) => {
						if (err) {
							reject(err);
						} else {
							resolve(connection);
						}
					});
				});

				try {
					const sql = `DROP TABLE "${config.tableName}"`;
					await new Promise<void>((resolve) => {
						conn.query(sql, (_err: Error | null) => {
							// Ignore error if table doesn't exist
							resolve();
						});
					});

					context.logger.info(`Table ${config.tableName} dropped`);
				} finally {
					await new Promise<void>((resolve) => {
						conn.close((_err: Error | null) => {
							// Always resolve to continue execution
							resolve();
						});
					});
				}
			} catch (error) {
				context.logger.info(
					`Table ${config.tableName} does not exist yet or could not be dropped (continuing)`,
				);
			}
		}

		try {
			await DB2VectorStore.fromDocuments(documents, embeddings, config);
		} catch (error) {
			const errorMessage = createSafeErrorMessage(error);

			// Handle dimension mismatch error specifically
			if (
				errorMessage.includes('dimension mismatch') ||
				errorMessage.includes('Embedding dimension')
			) {
				throw new NodeOperationError(
					context.getNode(),
					`DB2 embedding dimension mismatch: ${errorMessage}`,
					{
						itemIndex,
						description:
							'The table expects embeddings with different dimensions. Enable "Clear Table" option to recreate the table with correct dimensions, or use a different table name.',
					},
				);
			}

			throw new NodeOperationError(
				context.getNode(),
				`Error inserting documents into DB2: ${errorMessage}`,
				{ itemIndex },
			);
		}
	},

	releaseVectorStoreClient(vectorStore) {
		void vectorStore.close();
	},
}) {}

// Made with Bob
