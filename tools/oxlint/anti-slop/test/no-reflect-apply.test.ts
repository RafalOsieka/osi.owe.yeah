import { describe, it } from 'vite-plus/test';
import { RuleTester } from 'vite-plus/lint/plugins-dev';

import { noReflectApplyRule } from '../rules/no-reflect-apply.ts';

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });
const error = { messageId: 'reflectApply' };

describe('anti-slop/no-reflect-apply', () => {
  it('covers RuleTester valid and invalid cases', () => {
    tester.run('anti-slop/no-reflect-apply', noReflectApplyRule, {
      valid: [
        'const value = operation.apply(owner, args);',
        'Reflect.get(owner, key);',
        'const Reflect = { apply() { return 1; } }; Reflect.apply();',
        'function invoke(Reflect: { apply(): number }) { return Reflect.apply(); }',
      ],
      invalid: [
        { code: 'const value = Reflect.apply(operation, owner, args);', errors: [error] },
        { code: "const value = Reflect['apply'](operation, owner, args);", errors: [error] },
      ],
    });
  });
});
