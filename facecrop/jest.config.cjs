module.exports = {
    testEnvironment: 'jsdom',
    transform: {'^.+\\.js$': 'babel-jest'},
    testMatch: ['<rootDir>/tests/**/*.test.js'],
    testPathIgnorePatterns: ['/node_modules/']
};
