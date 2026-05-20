/**
 * Type declarations for ibm_db module
 * This provides TypeScript types for the IBM DB2 native driver
 */

declare module 'ibm_db' {
	/**
	 * DB2 Connection interface
	 */
	export interface Connection {
		/**
		 * Execute a SQL query with optional parameters
		 * @param sql - SQL query string
		 * @param callback - Callback function with error and result
		 */
		query(sql: string, callback: (error: Error | null, result: unknown) => void): void;

		/**
		 * Execute a SQL query with parameters
		 * @param sql - SQL query string
		 * @param params - Query parameters
		 * @param callback - Callback function with error and result
		 */
		query(
			sql: string,
			params: unknown[],
			callback: (error: Error | null, result: unknown) => void,
		): void;

		/**
		 * Close the database connection
		 * @param callback - Callback function with error
		 */
		close(callback: (error: Error | null) => void): void;

		/**
		 * Prepare a SQL statement
		 * @param sql - SQL statement to prepare
		 * @param callback - Callback function with error and prepared statement
		 */
		prepare(sql: string, callback: (error: Error | null, statement: Statement) => void): void;
	}

	/**
	 * Prepared Statement interface
	 */
	export interface Statement {
		/**
		 * Execute the prepared statement with parameters
		 * @param params - Statement parameters
		 * @param callback - Callback function with error and result
		 */
		execute(params: unknown[], callback: (error: Error | null, result: unknown) => void): void;

		/**
		 * Close the prepared statement
		 * @param callback - Callback function with error
		 */
		close(callback: (error: Error | null) => void): void;
	}

	/**
	 * Open a database connection
	 * @param connectionString - DB2 connection string
	 * @param callback - Callback function with error and connection
	 */
	export function open(
		connectionString: string,
		callback: (error: Error | null, connection: Connection) => void,
	): void;

	/**
	 * Open a database connection synchronously
	 * @param connectionString - DB2 connection string
	 * @returns Connection object
	 */
	export function openSync(connectionString: string): Connection;
}

// Made with Bob
