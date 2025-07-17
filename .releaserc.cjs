module.exports = {
  branches: ['main'],
  repositoryUrl: 'https://github.com/MarkShawn2020/n-clip',
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
        releaseRules: [
          { type: 'feat', release: 'minor' },
          { type: 'fix', release: 'patch' },
          { type: 'docs', release: false },
          { type: 'style', release: false },
          { type: 'refactor', release: 'patch' },
          { type: 'perf', release: 'patch' },
          { type: 'test', release: false },
          { type: 'chore', release: false },
          { type: 'build', release: false },
          { type: 'ci', release: false },
          { scope: 'no-release', release: false }
        ],
        parserOpts: {
          noteKeywords: ['BREAKING CHANGE', 'BREAKING CHANGES']
        }
      }
    ],
    '@semantic-release/release-notes-generator',
    '@semantic-release/changelog',
    [
      '@semantic-release/npm',
      {
        npmPublish: false
      }
    ],
    [
      '@semantic-release/exec',
      {
        prepareCmd: 'pnpm run dist:ci'
      }
    ],
    [
      '@semantic-release/github',
      {
        assets: [
          {
            path: 'release/**/*.dmg',
            label: 'macOS DMG Installer'
          },
          {
            path: 'release/**/*.zip',
            label: 'macOS ZIP Archive'
          },
          {
            path: 'release/**/*.yml',
            label: 'Update Info'
          }
        ]
      }
    ],
    [
      '@semantic-release/git',
      {
        assets: ['package.json', 'CHANGELOG.md'],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}'
      }
    ]
  ]
}