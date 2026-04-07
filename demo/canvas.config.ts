export default {
  mocks: {
    '$app/environment': './.canvas/mocks/app-environment.ts'
  },
  purity: {
    componentPaths: ['./src/lib/components/'],
    forbiddenImports: ['$app/navigation', '$env/']
  }
};
