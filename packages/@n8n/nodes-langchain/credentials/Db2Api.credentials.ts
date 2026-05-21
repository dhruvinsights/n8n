import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class Db2Api implements ICredentialType {
	name = 'db2Api';

	displayName = 'DB2 API';

	documentationUrl = 'db2';

	properties: INodeProperties[] = [
		{
			displayName: 'Database Name',
			name: 'database',
			type: 'string',
			default: '',
			required: true,
			description: 'The name of the DB2 database',
		},
		{
			displayName: 'Hostname',
			name: 'host',
			type: 'string',
			default: 'localhost',
			required: true,
			description: 'The hostname or IP address of the DB2 server',
		},
		{
			displayName: 'Port',
			name: 'port',
			type: 'number',
			default: 50000,
			required: true,
			description: 'The port number for the DB2 server',
		},
		{
			displayName: 'Username',
			name: 'user',
			type: 'string',
			default: '',
			required: true,
			description: 'The username for DB2 authentication',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'The password for DB2 authentication',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {},
	};
}
