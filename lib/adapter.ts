import { toFsImportPath } from './utils.ts';

export interface ComponentEntry {
  key: string;
  absolutePath: string;
}

export interface PurityConfig {
  componentPaths: string[];
  forbiddenImports: string[];
}

export interface FrameworkAdapter {
  fileExtensions: string[];
  generateComponentModule(components: ComponentEntry[]): string;
  defaultPurityRules(): PurityConfig;
  isPrototypeScreen(screenSource: string): boolean;
}

const SVELTEKIT_DEFAULT_PURITY: PurityConfig = {
  componentPaths: ['$lib/components/'],
  forbiddenImports: ['$lib/stores/', '$lib/api/', '$app/navigation', '$app/environment']
};

export class SvelteAdapter implements FrameworkAdapter {
  fileExtensions = ['.svelte'];

  generateComponentModule(components: ComponentEntry[]): string {
    const importLines = components.map((entry, index) => {
      return `import Component${index} from ${JSON.stringify(toFsImportPath(entry.absolutePath))};`;
    });
    const objectEntries = components.map((entry, index) => {
      return `  ${JSON.stringify(entry.key)}: Component${index}`;
    });

    return [
      ...importLines,
      `const components = ${objectEntries.length > 0 ? `\n{\n${objectEntries.join(',\n')}\n}` : '{}'};`,
      'export default components;'
    ].join('\n');
  }

  defaultPurityRules(): PurityConfig {
    return {
      componentPaths: [...SVELTEKIT_DEFAULT_PURITY.componentPaths],
      forbiddenImports: [...SVELTEKIT_DEFAULT_PURITY.forbiddenImports]
    };
  }

  isPrototypeScreen(screenSource: string): boolean {
    const importLines = screenSource
      .split(/\r?\n/u)
      .filter((line) => line.trimStart().startsWith('import '));

    return !importLines.some((line) => line.includes('$lib/'));
  }
}
