import base from '@workspace/eslint-config';

/**
 * The editor does no I/O of its own (epic #64): whoever hosts it — the standalone editor, our app —
 * provides saving, loading and everything network-bound through the host interface. These rules
 * are that boundary; do not relax them to make a feature fit, put the feature in the host.
 */
const NO_IO = {
    paths: [
        { name: '@workspace/api-client', message: 'The editor has no server; hosts talk to it.' },
        { name: 'react-router-dom', message: 'Routing belongs to the host app.' },
        { name: 'react-router', message: 'Routing belongs to the host app.' },
    ],
    patterns: [{ group: ['node:*'], message: 'The editor runs in the browser only.' }],
};

export default [
    ...base,
    {
        files: ['src/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': ['error', NO_IO],
            'no-restricted-globals': [
                'error',
                ...['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map((name) => ({
                    name,
                    message: 'The editor makes no network requests; the host does.',
                })),
            ],
        },
    },
    {
        // Tests may read fixtures from disk.
        files: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
        rules: { 'no-restricted-imports': ['error', { ...NO_IO, patterns: [] }] },
    },
];
