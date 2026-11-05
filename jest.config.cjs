/** @type {import('jest').Config} */
module.exports = {
	testEnvironment: 'node',
	testMatch: ['**/__tests__/**/*.test.ts'],
	// `.ts` before `.js`, so a test importing `../main` never loads the built bundle.
	moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'cjs', 'json', 'node'],
	// `obsidian` exists only inside the app; tests load an inert stub.
	moduleNameMapper: {
		'^obsidian$': '<rootDir>/__tests__/__mocks__/obsidian.ts',
	},
	// obsidian-recording-importer-core ships TypeScript source, so jest must
	// transform it instead of skipping node_modules.
	transformIgnorePatterns: ['/node_modules/(?!obsidian-recording-importer-core/)'],
	transform: {
		'^.+\\.ts$': ['ts-jest', {
			tsconfig: {
				module: 'CommonJS',
			},
		}],
	},
};
