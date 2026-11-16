import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '_private/**',
      'node_modules/**',
      '**/dist/**',
      '**/build/**',
      '.codeartsdoer/**',
      'coverage/**',
      'releases/**',
      'runtime/**',
      'data/**',
      'logs/**',
      '**/*.min.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-implicit-coercion': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['apps/api/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@nestjs/*',
                'fastify',
                'rxjs',
                '**/infrastructure/**',
                '**/application/**',
                '**/interfaces/**',
                '**/composition/**',
              ],
              message: 'domain 层不得依赖框架、基础设施、应用层、接口层或装配层',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@nestjs/*',
                'fastify',
                '**/infrastructure/**',
                '**/interfaces/**',
                '**/composition/**',
              ],
              message: 'application 层不得依赖框架、基础设施、接口层或装配层，应通过 ports 接口',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/ui/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/features/**',
                '@/api/**',
                '@/pages/**',
                '@/router/**',
                'pinia',
                'vue-router',
              ],
              message: 'ui 层不得引用 features、api、pages、router、pinia 或业务枚举',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/pages/**/*.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    files: ['apps/web/src/features/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['@/pages/**'], message: 'features 不得引用 pages' }],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/**/*-cli.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['scripts/**/*.{mjs,js,ts}'],
    rules: {
      'no-console': 'off',
    },
  },
);
