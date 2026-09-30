import base from '@workspace/eslint-config';

/**
 * The standalone editor reads and writes local files only (#69): no account, no server, no
 * network. Libraries and anything else that needs one belong to a host that has one.
 */
export default [
    ...base,
    {
        files: ['src/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: '@workspace/api-client',
                            message: 'The standalone editor has no server.',
                        },
                    ],
                },
            ],
            'no-restricted-globals': [
                'error',
                ...['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map((name) => ({
                    name,
                    message: 'The standalone editor makes no network requests.',
                })),
            ],
        },
    },
];
