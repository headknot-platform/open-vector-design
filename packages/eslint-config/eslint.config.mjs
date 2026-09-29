// Shared ESLint flat config (ESLint >= 9).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
    {
        ignores: [
            '**/dist/**',
            '**/build/**',
            '**/.turbo/**',
            // Vite's dependency cache (pre-bundled, minified third-party code) can land in an app
            // folder; linting it took minutes and says nothing about our code.
            '**/.vite/**',
            '**/node_modules/**',
            '**/coverage/**',
            // OVD project files — written by the canonical serialiser, not by hand.
            'examples/**',
        ],
    },

    js.configs.recommended,
    ...tseslint.configs.recommended,

    // Prettier as a rule, with conflicting stylistic rules turned off. Imported from the
    // /recommended entry point: the legacy `configs.recommended` shape carries `extends`, which
    // flat config rejects outright.
    prettierRecommended,

    {
        files: ['**/*.{ts,tsx,js,jsx}'],
        plugins: { 'react-hooks': reactHooks },
        rules: {
            // A violation is always a bug; neither tsc nor the build can see hook order.
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
        },
    },

    {
        files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
        languageOptions: {
            parser: tseslint.parser,
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.node, ...globals.browser },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
];
