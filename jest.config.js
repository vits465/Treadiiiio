module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  setupFiles: ['./tests/jest.env.js'],
  verbose: true,
  forceExit: true,
  clearMocks: true
};
