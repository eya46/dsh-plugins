import { describe, expect, it } from 'vitest'
import { isFullyPrivate, stripPrivateContent } from '../src/privacy.ts'
import { formatProfile, formatRecall, mentionsMemory, recallQuery } from '../src/prompt.ts'
import { memoryTags, normalizeGitRemote } from '../src/tags.ts'

const PATTERNS = ['remember\\s+(?:that|this)', 'don\'?t\\s+forget', 'save\\s+this']

describe('privacy', () => {
  it('redacts a private block and keeps the surrounding text', () => {
    expect(stripPrivateContent('keep <private>secret</private> this')).toBe('keep [REDACTED] this')
    expect(isFullyPrivate('<private>secret</private>')).toBe(true)
    expect(isFullyPrivate('keep <private>secret</private>')).toBe(false)
  })
})

describe('recall selection', () => {
  it('skips commands and short prompts', () => {
    expect(recallQuery('/compact now please')).toBeUndefined()
    expect(recallQuery('hi')).toBeUndefined()
    expect(recallQuery('how did we build this')).toBe('how did we build this')
  })

  it('matches a remember request outside code and ignores one inside it', () => {
    expect(mentionsMemory('Remember that tests use vitest', PATTERNS)).toBe(true)
    expect(mentionsMemory('please remember the port', ['please\\s+remember'])).toBe(true)
    expect(mentionsMemory("don't forget the port", PATTERNS)).toBe(true)
    expect(mentionsMemory('save this convention', PATTERNS)).toBe(true)
    expect(mentionsMemory('I remember nothing', PATTERNS)).toBe(false)
    expect(mentionsMemory('run `remember --dry-run`', PATTERNS)).toBe(false)
    expect(mentionsMemory('```\nremember this\n```', PATTERNS)).toBe(false)
  })
})

describe('prompt formatting', () => {
  it('omits an empty profile and credits recall hits', () => {
    expect(formatProfile({ staticFacts: [], dynamicFacts: [] }, 5)).toBe('')
    expect(formatProfile({ staticFacts: ['uses bun'], dynamicFacts: [] }, 5)).toContain('◪ uses bun')
    const recall = formatRecall([{ id: '1', text: 'build fails without .env', similarity: 0.82, containerTag: 'repo' }])
    expect(recall).toContain('[82%]')
    expect(recall).toContain('<supermemory-context>')
  })
})

describe('project tags', () => {
  it('normalizes https and ssh remotes to the same identity', () => {
    expect(normalizeGitRemote('https://github.com/eya46/dsh-plugins.git'))
      .toBe(normalizeGitRemote('git@github.com:eya46/dsh-plugins.git'))
  })

  it('builds the shared repository container tag', () => {
    const tags = memoryTags(process.cwd())
    expect(tags.canonical).toMatch(/^repo_[a-z0-9_]+__[0-9a-f]{16}$/)
    expect(tags.personalReads).toEqual([tags.canonical])
    expect(tags.projectReads).toEqual([tags.canonical])
  })
})
