import { describe, expect, it } from 'vitest';
import { parseHref, relativePath, resolveInstance } from './index';
import { readComponentFile } from './read';
import type { Project } from './model';

const button = readComponentFile(
    'components/button.svg',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:ovd="https://ovd.dev/ns/0.1" ovd:type="library">
      <defs>
        <symbol id="c_button" ovd:type="component-set" ovd:name="Button"
                ovd:props='{"variant":["primary","secondary"],"size":["md","sm"]}'
                ovd:default="variant=primary,size=md">
          <symbol id="c_button__primary_md" ovd:type="component" ovd:variant="variant=primary,size=md" width="160" height="48"/>
          <symbol id="c_button__secondary_md" ovd:type="component" ovd:variant="variant=secondary,size=md" width="160" height="48"/>
          <symbol id="c_button__primary_sm" ovd:type="component" ovd:variant="variant=primary,size=sm" width="120" height="36"/>
        </symbol>
      </defs>
    </svg>`,
);

const project = {
    manifest: {
        version: '0.1',
        name: 't',
        id: '',
        exports: 'exports/',
        tokens: [],
        themes: {},
        pages: [],
    },
    pages: [],
    components: [button],
    tokens: {},
    assets: {},
    comments: {},
    other: {},
} satisfies Project;

const pick = (href: string, variant?: string) =>
    resolveInstance(project, 'pages/home.svg', { href, variant })?.variant.id;

describe('resolveInstance (spec §5)', () => {
    it('uses the default variant when none is given', () => {
        expect(pick('../components/button.svg#c_button')).toBe('c_button__primary_md');
    });

    it('applies ovd:variant over the default', () => {
        expect(pick('../components/button.svg#c_button', 'size=sm')).toBe('c_button__primary_sm');
        expect(pick('../components/button.svg#c_button', 'variant=secondary,size=md')).toBe(
            'c_button__secondary_md',
        );
    });

    it('accepts the bare-value form from the spec §4 example for the first axis', () => {
        expect(pick('../components/button.svg#c_button', 'secondary')).toBe(
            'c_button__secondary_md',
        );
    });

    it('accepts a direct reference to one variant symbol', () => {
        expect(pick('../components/button.svg#c_button__primary_sm')).toBe('c_button__primary_sm');
    });

    it('returns nothing for missing files, ids and unloaded libraries', () => {
        expect(pick('../components/nope.svg#c_button')).toBeUndefined();
        expect(pick('../components/button.svg#nope')).toBeUndefined();
        expect(pick('core-ui:button.svg#c_button')).toBeUndefined();
    });
});

describe('hrefs', () => {
    it('parses library references', () => {
        expect(parseHref('pages/a.svg', 'core-ui:button.svg#c_button')).toEqual({
            library: 'core-ui',
            file: 'button.svg',
            id: 'c_button',
        });
    });

    it('does not mistake a URL scheme for a library', () => {
        expect(parseHref('pages/a.svg', 'https://x.dev/b.svg#c').library).toBeUndefined();
    });

    it('computes relative paths between project files', () => {
        expect(relativePath('pages/a.svg', 'components/button.svg')).toBe(
            '../components/button.svg',
        );
        expect(relativePath('pages/a.svg', 'pages/b.svg')).toBe('b.svg');
    });
});
