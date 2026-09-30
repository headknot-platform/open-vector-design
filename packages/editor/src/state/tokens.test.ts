import { canonicalJson, findNode, type TextNode } from '@workspace/ovd-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { docRoots } from '../lib/doc';
import { loadStarter } from '../test/starter';
import { parseTokenValue } from '../panels/TokensPanel';
import { editor, tokenSetFor } from './store';
import { addToken, applyTextStyle, removeToken, updateToken } from './tokens';

type TypographyDoc = { typography: { heading: { md: { $value: Record<string, unknown> } } } };

const text = (id: string) => findNode(docRoots(editor().project!, editor().doc), id) as TextNode;
const tokens = () => tokenSetFor(editor().project!, editor().previewTheme);

describe('token manager (spec §8)', () => {
    beforeEach(() => {
        editor().loadProject(loadStarter(), { kind: 'local', name: 'Starter' });
    });

    it('parses typed values into DTCG values', () => {
        expect(parseTokenValue('{color.primary}', 'color')).toBe('{color.primary}');
        expect(parseTokenValue('12', 'dimension')).toEqual({ value: 12, unit: 'px' });
        expect(parseTokenValue('1.5rem', 'dimension')).toEqual({ value: 1.5, unit: 'rem' });
        expect(parseTokenValue('150ms', 'duration')).toEqual({ value: 150, unit: 'ms' });
        expect(parseTokenValue('[0.4, 0, 0.2, 1]', 'cubicBezier')).toEqual([0.4, 0, 0.2, 1]);
    });

    it('adds, edits and removes tokens as one undo step each, keeping files canonical', () => {
        addToken('tokens/base.tokens.json', 'color.brand', 'color', '#123456');
        expect(tokens().tokens.get('color.brand')?.css).toBe('#123456');
        updateToken('tokens/base.tokens.json', 'color.brand', '{color.primary}');
        expect(tokens().tokens.get('color.brand')?.aliasOf).toBe('color.primary');
        removeToken('tokens/base.tokens.json', 'color.brand');
        expect(tokens().tokens.has('color.brand')).toBe(false);
        expect(editor().past).toHaveLength(3);
        const json = canonicalJson(editor().project!.tokens['tokens/base.tokens.json']);
        expect(JSON.parse(json)).toEqual(editor().project!.tokens['tokens/base.tokens.json']);
    });

    it('re-applies a typography token to bound text when the token changes', () => {
        applyTextStyle(['t_body'], '{typography.heading.md}', tokens());
        expect(text('t_body')).toMatchObject({
            fontSize: 20,
            fontWeight: 600,
            textStyle: '{typography.heading.md}',
        });
        const value = structuredClone(
            (editor().project!.tokens['tokens/base.tokens.json'] as TypographyDoc).typography
                .heading.md.$value,
        );
        value.fontSize = { value: 26, unit: 'px' };
        updateToken('tokens/base.tokens.json', 'typography.heading.md', value);
        expect(text('t_body').fontSize).toBe(26);
    });
});
