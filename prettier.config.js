export default {
    tabWidth: 4,
    useTabs: false,
    printWidth: 100,
    singleQuote: true,
    trailingComma: 'all',
    semi: true,
    endOfLine: 'lf',
    overrides: [
        // OVD project files are written by the canonical serialiser (spec §10); Prettier must not
        // reformat them, or `ovd fmt` and Prettier would fight over every file.
        { files: 'examples/**', options: { requirePragma: true } },
    ],
};
