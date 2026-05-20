/**
 * DB2 Security Validation Functions
 * Provides SQL injection prevention and input validation for DB2 operations
 */

/**
 * Validates database name format
 * DB2 database names must be 1-8 characters, alphanumeric
 */
export function validateDatabaseName(dbName: string): boolean {
	if (!dbName || typeof dbName !== 'string') {
		return false;
	}
	// DB2 database names: 1-8 chars, alphanumeric, must start with letter
	const dbNameRegex = /^[A-Za-z][A-Za-z0-9]{0,7}$/;
	return dbNameRegex.test(dbName);
}

/**
 * Validates hostname format
 * Allows valid hostnames, IP addresses, and localhost
 */
export function validateHostname(hostname: string): boolean {
	if (!hostname || typeof hostname !== 'string') {
		return false;
	}
	// Allow localhost, IP addresses, and valid hostnames
	const hostnameRegex =
		/^(localhost|(\d{1,3}\.){3}\d{1,3}|([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)$/;
	return hostnameRegex.test(hostname);
}

/**
 * Validates port number
 * Must be between 1 and 65535
 */
export function validatePort(port: number | string): boolean {
	const portNum = typeof port === 'string' ? parseInt(port, 10) : port;
	return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
}

/**
 * Validates DB2 identifier (table name, column name, schema name)
 * DB2 identifiers: 1-128 chars, alphanumeric plus underscore, must start with letter or underscore
 */
export function validateIdentifier(identifier: string): boolean {
	if (!identifier || typeof identifier !== 'string') {
		return false;
	}
	// DB2 regular identifiers: start with letter/underscore, contain alphanumeric/underscore
	// Max 128 characters
	const identifierRegex = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
	return identifierRegex.test(identifier);
}

/**
 * Gets a safely quoted identifier for SQL queries
 * Uses double quotes for case-sensitive or special identifiers
 */
export function getQuotedIdentifier(identifier: string): string {
	if (!validateIdentifier(identifier)) {
		throw new Error(`Invalid DB2 identifier: ${identifier}`);
	}
	// Return quoted identifier to preserve case and allow special chars
	return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Sanitizes a string value for use in SQL
 * Escapes single quotes to prevent SQL injection
 */
export function sanitizeSqlString(value: string): string {
	if (typeof value !== 'string') {
		return String(value);
	}
	// Escape single quotes by doubling them
	return value.replace(/'/g, "''");
}

/**
 * Creates a safe error message that doesn't expose sensitive information
 * Removes connection strings, passwords, and other credentials
 */
export function createSafeErrorMessage(error: Error | unknown): string {
	const message = error instanceof Error ? error.message : String(error);

	// Remove potential sensitive information
	const sanitized = message
		.replace(/password[=:]\s*[^\s;]+/gi, 'password=***')
		.replace(/pwd[=:]\s*[^\s;]+/gi, 'pwd=***')
		.replace(/apikey[=:]\s*[^\s;]+/gi, 'apikey=***')
		.replace(/token[=:]\s*[^\s;]+/gi, 'token=***')
		.replace(/DATABASE=([^;]+)/gi, 'DATABASE=***')
		.replace(/HOSTNAME=([^;]+)/gi, 'HOSTNAME=***')
		.replace(/UID=([^;]+)/gi, 'UID=***');

	return sanitized;
}

/**
 * Validates a complete DB2 connection configuration
 */
export interface Db2ConnectionConfig {
	database: string;
	hostname: string;
	port: number | string;
	username: string;
	password: string;
}

export function validateConnectionConfig(config: Db2ConnectionConfig): {
	valid: boolean;
	errors: string[];
} {
	const errors: string[] = [];

	if (!validateDatabaseName(config.database)) {
		errors.push(
			'Invalid database name. Must be 1-8 alphanumeric characters starting with a letter.',
		);
	}

	if (!validateHostname(config.hostname)) {
		errors.push('Invalid hostname format.');
	}

	if (!validatePort(config.port)) {
		errors.push('Invalid port number. Must be between 1 and 65535.');
	}

	if (!config.username || typeof config.username !== 'string') {
		errors.push('Username is required.');
	}

	if (!config.password || typeof config.password !== 'string') {
		errors.push('Password is required.');
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

// Made with Bob
