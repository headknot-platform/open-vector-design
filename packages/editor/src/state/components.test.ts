import { findNode, readProject, resolveInstance, writeProject } from '@workspace/ovd-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { docRoots } from '../lib/doc';
import { loadStarter } from '../test/starter';
import {
    addVariant,
    createComponentFromSelection,
    detachInstance,
    setInstanceVariant,
    setOverride,
} from './components';
import { editor } from './store';

const node = (id: string) => findNode(docRoots(editor().project!, editor().doc), id)!;

describe('components (spec §5)', () => {
    beforeEach(() => {
        editor().loadProject(loadStarter(), { kind: 'local', name: 'Starter' });
    });

    it('creates a component in its own file and survives save → reopen', () => {
        editor().select(['e_orb_1', 'e_orb_2']);
        createComponentFromSelection();
        const inst = node(editor().selection[0]!);
        expect(inst.type).toBe('instance');
        const files = writeProject(editor().project!);
        expect(Object.keys(files)).toContain('components/component.svg');
        const reopened = readProject(files);
        expect(resolveInstance(reopened, 'pages/onboarding.svg', inst as never)?.variant.id).toBe(
            'c_component',
        );
    });

    it('stores overrides and variants on the instance only', () => {
        setOverride('i_secondary', 'label', { text: 'Log in' });
        setInstanceVariant('i_secondary', 'size', 'sm');
        const inst = node('i_secondary');
        expect(inst).toMatchObject({
            overrides: [{ target: 'label', text: 'Log in' }],
            variant: 'variant=secondary,size=sm',
        });
        // The component file is untouched: source files hold only the <use> and its overrides.
        const svg = writeProject(editor().project!)['components/button.svg'] as string;
        expect(svg).not.toContain('Log in');
    });

    it('detaches into a frame that records where it came from', () => {
        editor().select(['i_cta']);
        detachInstance('i_cta');
        const f = node(editor().selection[0]!);
        expect(f.type).toBe('frame');
        expect(f.extra['ovd:detached-from']).toBe('../components/button.svg#c_button');
    });

    it('turns a standalone component into a set when a variant is added', () => {
        editor().select(['e_orb_1']);
        createComponentFromSelection();
        editor().openDoc({ kind: 'component', file: 'components/component.svg' });
        addVariant('c_component');
        const set = editor().project!.components.at(-1)!.sets[0]!;
        expect(set.isSet).toBe(true);
        expect(set.variants.map((v) => v.variant)).toEqual(['variant=default', 'variant=variant2']);
        // Existing instances point at the original symbol id, which is kept.
        expect(set.variants[0]!.id).toBe('c_component');
    });
});
