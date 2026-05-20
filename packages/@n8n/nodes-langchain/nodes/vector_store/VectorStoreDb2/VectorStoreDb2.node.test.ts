import { mock } from 'jest-mock-extended';
import type { ISupplyDataFunctions } from 'n8n-workflow';
import * as Db2Node from './VectorStoreDb2.node';
import { DB2VectorStore } from './db2vs';

// Mock external modules
jest.mock('ibm_db', () => ({
	open: jest.fn(),
}));

jest.mock('./db2vs', () => {
	return {
		DB2VectorStore: jest.fn().mockImplementation(() => ({
			addDocuments: jest.fn(),
			addTexts: jest.fn(),
			similaritySearch: jest.fn(),
			similaritySearchWithScore: jest.fn(),
			similaritySearchVectorWithScore: jest.fn(),
			maximalMarginalRelevanceSearch: jest.fn(),
			delete: jest.fn(),
			close: jest.fn(),
			filter: undefined,
		})),
	};
});

jest.mock(
	'@n8n/ai-utilities',
	() => ({
		createVectorStoreNode: (config: {
			getVectorStoreClient: (...args: unknown[]) => unknown;
			populateVectorStore: (...args: unknown[]) => unknown;
			releaseVectorStoreClient: (...args: unknown[]) => unknown;
			methods: {
				listSearch: {
					db2TablesSearch: (
						this: ISupplyDataFunctions,
					) => Promise<{ results: Array<{ name: string; value: string }> }>;
				};
			};
		}) =>
			class BaseNode {
				async getVectorStoreClient(...args: unknown[]) {
					return config.getVectorStoreClient.apply(config, args);
				}

				async populateVectorStore(...args: unknown[]) {
					return config.populateVectorStore.apply(config, args);
				}

				releaseVectorStoreClient(...args: unknown[]) {
					return config.releaseVectorStoreClient?.apply(config, args);
				}

				async db2TablesSearch(...args: unknown[]) {
					return await config.methods.listSearch.db2TablesSearch.apply(this as any, args as any);
				}
			},
		metadataFilterField: {},
	}),
	{ virtual: true },
);

const MockDB2VectorStore = DB2VectorStore as jest.MockedClass<typeof DB2VectorStore>;

describe('VectorStoreDb2.node', () => {
	const helpers = mock<ISupplyDataFunctions['helpers']>();
	const dataFunctions = mock<ISupplyDataFunctions>({ helpers });
	dataFunctions.logger = {
		info: jest.fn(),
		debug: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
		verbose: jest.fn(),
	} as unknown as ISupplyDataFunctions['logger'];

	const db2Credentials = {
		database: 'TESTDB',
		host: 'localhost',
		port: 50000,
		user: 'db2admin',
		password: 'test-password',
	};

	const mockConnection = {
		query: jest.fn(),
		close: jest.fn(),
	};

	beforeEach(() => {
		jest.resetAllMocks();
		MockDB2VectorStore.fromExistingTable = jest.fn().mockResolvedValue({
			similaritySearchVectorWithScore: jest.fn(),
			close: jest.fn(),
			filter: undefined,
		});
		MockDB2VectorStore.fromDocuments = jest.fn().mockResolvedValue(undefined);
	});

	describe('getVectorStoreClient', () => {
		it('should create DB2 vector store client with valid config', async () => {
			const mockEmbeddings = {};
			const mockVectorStore = {
				similaritySearchVectorWithScore: jest.fn(),
				close: jest.fn(),
				filter: undefined,
			};

			MockDB2VectorStore.fromExistingTable = jest.fn().mockResolvedValue(mockVectorStore);

			const context = {
				getCredentials: jest.fn().mockResolvedValue(db2Credentials),
				getNodeParameter: jest.fn((name: string) => {
					if (name === 'db2Table') return 'test_vectors';
					if (name === 'options') return {};
					return undefined;
				}),
				getNode: () => ({
					name: 'VectorStoreDb2',
					credentials: { db2: {} },
				}),
				logger: dataFunctions.logger,
			} as never;

			const node = new Db2Node.VectorStoreDb2();
			const result = await (node as any).getVectorStoreClient(
				context,
				undefined,
				mockEmbeddings,
				0,
			);

			expect(MockDB2VectorStore.fromExistingTable).toHaveBeenCalledWith(
				mockEmbeddings,
				expect.objectContaining({
					tableName: 'test_vectors',
					connectionParams: expect.objectContaining({
						database: 'TESTDB',
						hostname: 'localhost',
						port: 50000,
						username: 'db2admin',
						password: 'test-password',
					}),
				}),
			);
			expect(result).toBe(mockVectorStore);
		});

		it('should apply filter to vector store', async () => {
			const mockEmbeddings = {};
			const mockVectorStore = {
				similaritySearchVectorWithScore: jest.fn(),
				close: jest.fn(),
				filter: undefined,
			};

			MockDB2VectorStore.fromExistingTable = jest.fn().mockResolvedValue(mockVectorStore);

			const filter = { category: 'test' };

			const context = {
				getCredentials: jest.fn().mockResolvedValue(db2Credentials),
				getNodeParameter: jest.fn((name: string) => {
					if (name === 'db2Table') return 'test_vectors';
					if (name === 'options') return {};
					return undefined;
				}),
				getNode: () => ({
					name: 'VectorStoreDb2',
					credentials: { db2: {} },
				}),
				logger: dataFunctions.logger,
			} as never;

			const node = new Db2Node.VectorStoreDb2();
			const result = await (node as any).getVectorStoreClient(context, filter, mockEmbeddings, 0);

			expect(result.filter).toEqual(filter);
		});

		it('should handle invalid table name', async () => {
			const mockEmbeddings = {};

			const context = {
				getCredentials: jest.fn().mockResolvedValue(db2Credentials),
				getNodeParameter: jest.fn((name: string) => {
					if (name === 'db2Table') return '123invalid'; // Invalid: starts with number
					if (name === 'options') return {};
					return undefined;
				}),
				getNode: () => ({
					name: 'VectorStoreDb2',
					credentials: { db2: {} },
				}),
				logger: dataFunctions.logger,
			} as never;

			const node = new Db2Node.VectorStoreDb2();

			await expect(
				(node as any).getVectorStoreClient(context, undefined, mockEmbeddings, 0),
			).rejects.toThrow('Invalid table name');
		});

		it('should handle connection errors', async () => {
			const mockEmbeddings = {};

			MockDB2VectorStore.fromExistingTable = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

			const context = {
				getCredentials: jest.fn().mockResolvedValue(db2Credentials),
				getNodeParameter: jest.fn((name: string) => {
					if (name === 'db2Table') return 'test_vectors';
					if (name === 'options') return {};
					return undefined;
				}),
				getNode: () => ({
					name: 'VectorStoreDb2',
					credentials: { db2: {} },
				}),
				logger: dataFunctions.logger,
			} as never;

			const node = new Db2Node.VectorStoreDb2();

			await expect(
				(node as any).getVectorStoreClient(context, undefined, mockEmbeddings, 0),
			).rejects.toThrow('Error connecting to DB2');
		});
	});

	describe('populateVectorStore', () => {
		it('should populate vector store without clearing table', async () => {
			const mockEmbeddings = {};
			const mockDocuments = [{ pageContent: 'test', metadata: {} }];

			MockDB2VectorStore.fromDocuments = jest.fn().mockResolvedValue(undefined);

			const context = {
				getCredentials: jest.fn().mockResolvedValue(db2Credentials),
				getNodeParameter: jest.fn((name: string) => {
					if (name === 'db2Table') return 'test_vectors';
					if (name === 'options') return { clearTable: false };
					return undefined;
				}),
				getNode: () => ({
					name: 'VectorStoreDb2',
					credentials: { db2: {} },
				}),
				logger: dataFunctions.logger,
			} as never;

			const node = new Db2Node.VectorStoreDb2();
			await (node as any).populateVectorStore(context, mockEmbeddings, mockDocuments, 0);

			expect(MockDB2VectorStore.fromDocuments).toHaveBeenCalledWith(
				mockDocuments,
				mockEmbeddings,
				expect.objectContaining({
					tableName: 'test_vectors',
				}),
			);
		});

		it('should populate vector store and clear table if requested', async () => {
			const mockEmbeddings = {};
			const mockDocuments = [{ pageContent: 'test', metadata: {} }];

			const ibmDb = require('ibm_db');
			mockConnection.query.mockImplementation(
				(_sql: string, callback: (err: Error | null, result: any[]) => void) => {
					callback(null, []);
				},
			);
			mockConnection.close.mockImplementation((callback: (err: Error | null) => void) => {
				callback(null);
			});
			ibmDb.open = jest.fn((_connStr: string, callback: (err: Error | null, conn: any) => void) => {
				callback(null, mockConnection);
			});

			MockDB2VectorStore.fromDocuments = jest.fn().mockResolvedValue(undefined);

			const context = {
				getCredentials: jest.fn().mockResolvedValue(db2Credentials),
				getNodeParameter: jest.fn((name: string) => {
					if (name === 'db2Table') return 'test_vectors';
					if (name === 'options') return { clearTable: true };
					return undefined;
				}),
				getNode: () => ({
					name: 'VectorStoreDb2',
					credentials: { db2: {} },
				}),
				logger: dataFunctions.logger,
			} as never;

			const node = new Db2Node.VectorStoreDb2();
			await (node as any).populateVectorStore(context, mockEmbeddings, mockDocuments, 0);

			expect(mockConnection.query).toHaveBeenCalled();
			expect(MockDB2VectorStore.fromDocuments).toHaveBeenCalled();
		});

		it('should handle dimension mismatch errors', async () => {
			const mockEmbeddings = {};
			const mockDocuments = [{ pageContent: 'test', metadata: {} }];

			MockDB2VectorStore.fromDocuments = jest
				.fn()
				.mockRejectedValue(new Error('Embedding dimension mismatch. Expected 1536, got 768'));

			const context = {
				getCredentials: jest.fn().mockResolvedValue(db2Credentials),
				getNodeParameter: jest.fn((name: string) => {
					if (name === 'db2Table') return 'test_vectors';
					if (name === 'options') return {};
					return undefined;
				}),
				getNode: () => ({
					name: 'VectorStoreDb2',
					credentials: { db2: {} },
				}),
				logger: dataFunctions.logger,
			} as never;

			const node = new Db2Node.VectorStoreDb2();

			await expect(
				(node as any).populateVectorStore(context, mockEmbeddings, mockDocuments, 0),
			).rejects.toThrow('DB2 embedding dimension mismatch');
		});

		it('should handle empty document list', async () => {
			const mockEmbeddings = {};
			const mockDocuments: any[] = [];

			MockDB2VectorStore.fromDocuments = jest.fn().mockResolvedValue(undefined);

			const context = {
				getCredentials: jest.fn().mockResolvedValue(db2Credentials),
				getNodeParameter: jest.fn((name: string) => {
					if (name === 'db2Table') return 'test_vectors';
					if (name === 'options') return {};
					return undefined;
				}),
				getNode: () => ({
					name: 'VectorStoreDb2',
					credentials: { db2: {} },
				}),
				logger: dataFunctions.logger,
			} as never;

			const node = new Db2Node.VectorStoreDb2();
			await (node as any).populateVectorStore(context, mockEmbeddings, mockDocuments, 0);

			expect(MockDB2VectorStore.fromDocuments).toHaveBeenCalledWith(
				mockDocuments,
				mockEmbeddings,
				expect.any(Object),
			);
		});
	});

	describe('listSearch - db2TablesSearch', () => {
		it('should list tables successfully', async () => {
			const ibmDb = require('ibm_db');
			const tables = [{ TABNAME: 'VECTORS_TABLE' }, { TABNAME: 'DOCUMENTS_TABLE' }];

			mockConnection.query.mockImplementation(
				(_sql: string, callback: (err: Error | null, result: any[]) => void) => {
					callback(null, tables);
				},
			);
			mockConnection.close.mockImplementation((callback: (err: Error | null) => void) => {
				callback(null);
			});
			ibmDb.open = jest.fn((_connStr: string, callback: (err: Error | null, conn: any) => void) => {
				callback(null, mockConnection);
			});

			const context = {
				getCredentials: jest.fn().mockResolvedValue(db2Credentials),
				getNode: () => ({
					name: 'VectorStoreDb2',
					credentials: { db2: {} },
				}),
			} as never;

			const node = new Db2Node.VectorStoreDb2();
			const result = await (node as any).db2TablesSearch.call(context);

			expect(result).toEqual({
				results: [
					{ name: 'VECTORS_TABLE', value: 'VECTORS_TABLE' },
					{ name: 'DOCUMENTS_TABLE', value: 'DOCUMENTS_TABLE' },
				],
			});
		});

		it('should handle empty table list', async () => {
			const ibmDb = require('ibm_db');

			mockConnection.query.mockImplementation(
				(_sql: string, callback: (err: Error | null, result: any[]) => void) => {
					callback(null, []);
				},
			);
			mockConnection.close.mockImplementation((callback: (err: Error | null) => void) => {
				callback(null);
			});
			ibmDb.open = jest.fn((_connStr: string, callback: (err: Error | null, conn: any) => void) => {
				callback(null, mockConnection);
			});

			const context = {
				getCredentials: jest.fn().mockResolvedValue(db2Credentials),
				getNode: () => ({
					name: 'VectorStoreDb2',
					credentials: { db2: {} },
				}),
			} as never;

			const node = new Db2Node.VectorStoreDb2();
			const result = await (node as any).db2TablesSearch.call(context);

			expect(result).toEqual({ results: [] });
		});

		it('should handle connection errors', async () => {
			const ibmDb = require('ibm_db');
			ibmDb.open = jest.fn((_connStr: string, callback: (err: Error | null) => void) => {
				callback(new Error('ECONNREFUSED'));
			});

			const context = {
				getCredentials: jest.fn().mockResolvedValue(db2Credentials),
				getNode: () => ({
					name: 'VectorStoreDb2',
					credentials: { db2: {} },
				}),
			} as never;

			const node = new Db2Node.VectorStoreDb2();

			await expect((node as any).db2TablesSearch.call(context)).rejects.toThrow(
				'Cannot connect to DB2',
			);
		});

		it('should handle authentication errors', async () => {
			const ibmDb = require('ibm_db');
			ibmDb.open = jest.fn((_connStr: string, callback: (err: Error | null) => void) => {
				callback(new Error('SQL30082N Security processing failed'));
			});

			const context = {
				getCredentials: jest.fn().mockResolvedValue(db2Credentials),
				getNode: () => ({
					name: 'VectorStoreDb2',
					credentials: { db2: {} },
				}),
			} as never;

			const node = new Db2Node.VectorStoreDb2();

			await expect((node as any).db2TablesSearch.call(context)).rejects.toThrow(
				'Authentication failed',
			);
		});
	});

	describe('releaseVectorStoreClient', () => {
		it('should close the vector store connection', async () => {
			const mockVectorStore = {
				close: jest.fn().mockResolvedValue(undefined),
			};

			const node = new Db2Node.VectorStoreDb2();
			(node as any).releaseVectorStoreClient(mockVectorStore);

			// Close is called asynchronously, so we just verify it was called
			expect(mockVectorStore.close).toHaveBeenCalled();
		});
	});

	describe('Security validations', () => {
		it('should reject SQL injection attempts in table name', async () => {
			const mockEmbeddings = {};

			const context = {
				getCredentials: jest.fn().mockResolvedValue(db2Credentials),
				getNodeParameter: jest.fn((name: string) => {
					if (name === 'db2Table') return "test'; DROP TABLE users; --";
					if (name === 'options') return {};
					return undefined;
				}),
				getNode: () => ({
					name: 'VectorStoreDb2',
					credentials: { db2: {} },
				}),
				logger: dataFunctions.logger,
			} as never;

			const node = new Db2Node.VectorStoreDb2();

			await expect(
				(node as any).getVectorStoreClient(context, undefined, mockEmbeddings, 0),
			).rejects.toThrow('Invalid table name');
		});

		it('should validate connection parameters', async () => {
			const mockEmbeddings = {};
			const invalidCredentials = {
				database: 'TOOLONGDATABASENAME', // Invalid: > 8 chars
				host: 'localhost',
				port: 50000,
				user: 'db2admin',
				password: 'test-password',
			};

			const context = {
				getCredentials: jest.fn().mockResolvedValue(invalidCredentials),
				getNodeParameter: jest.fn((name: string) => {
					if (name === 'db2Table') return 'test_vectors';
					if (name === 'options') return {};
					return undefined;
				}),
				getNode: () => ({
					name: 'VectorStoreDb2',
					credentials: { db2: {} },
				}),
				logger: dataFunctions.logger,
			} as never;

			const node = new Db2Node.VectorStoreDb2();

			await expect(
				(node as any).getVectorStoreClient(context, undefined, mockEmbeddings, 0),
			).rejects.toThrow('Invalid DB2 connection configuration');
		});
	});

	describe('Custom column names', () => {
		it('should use custom column names when provided', async () => {
			const mockEmbeddings = {};
			const mockVectorStore = {
				similaritySearchVectorWithScore: jest.fn(),
				close: jest.fn(),
				filter: undefined,
			};

			MockDB2VectorStore.fromExistingTable = jest.fn().mockResolvedValue(mockVectorStore);

			const context = {
				getCredentials: jest.fn().mockResolvedValue(db2Credentials),
				getNodeParameter: jest.fn((name: string) => {
					if (name === 'db2Table') return 'test_vectors';
					if (name === 'options')
						return {
							textColumnName: 'content',
							embeddingColumnName: 'vector',
							metadataColumnName: 'meta',
							idColumnName: 'doc_id',
						};
					return undefined;
				}),
				getNode: () => ({
					name: 'VectorStoreDb2',
					credentials: { db2: {} },
				}),
				logger: dataFunctions.logger,
			} as never;

			const node = new Db2Node.VectorStoreDb2();
			await (node as any).getVectorStoreClient(context, undefined, mockEmbeddings, 0);

			expect(MockDB2VectorStore.fromExistingTable).toHaveBeenCalledWith(
				mockEmbeddings,
				expect.objectContaining({
					textColumnName: 'content',
					embeddingColumnName: 'vector',
					metadataColumnName: 'meta',
					idColumnName: 'doc_id',
				}),
			);
		});
	});

	describe('Distance strategies', () => {
		it('should use specified distance strategy', async () => {
			const mockEmbeddings = {};
			const mockVectorStore = {
				similaritySearchVectorWithScore: jest.fn(),
				close: jest.fn(),
				filter: undefined,
			};

			MockDB2VectorStore.fromExistingTable = jest.fn().mockResolvedValue(mockVectorStore);

			const context = {
				getCredentials: jest.fn().mockResolvedValue(db2Credentials),
				getNodeParameter: jest.fn((name: string) => {
					if (name === 'db2Table') return 'test_vectors';
					if (name === 'options') return { distanceStrategy: 'EUCLIDEAN_DISTANCE' };
					return undefined;
				}),
				getNode: () => ({
					name: 'VectorStoreDb2',
					credentials: { db2: {} },
				}),
				logger: dataFunctions.logger,
			} as never;

			const node = new Db2Node.VectorStoreDb2();
			await (node as any).getVectorStoreClient(context, undefined, mockEmbeddings, 0);

			expect(MockDB2VectorStore.fromExistingTable).toHaveBeenCalledWith(
				mockEmbeddings,
				expect.objectContaining({
					distanceStrategy: 'EUCLIDEAN_DISTANCE',
				}),
			);
		});
	});
});

// Made with Bob
