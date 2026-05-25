import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  formatRuntimeSkillLookupComment,
  formatRuntimeSkillLookupHint,
  hasPackageManagerInternalPath,
  isAbsolutePath,
  isPnpCachePath,
  isPnpUnpluggedPath,
  isPnpVirtualPath,
  isRuntimeSkillLookupComment,
  isStableLoadPath,
  rewriteSkillLoadPaths,
} from '../src/skill-paths.js'
import type { SkillEntry } from '../src/types.js'

const tempDirs: Array<string> = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'intent-skill-paths-'))
  tempDirs.push(root)
  return root
}

function skill(path: string): SkillEntry {
  return {
    name: 'core',
    path,
    description: '',
  }
}

describe('skill path helpers', () => {
  it('detects absolute paths across common operating systems', () => {
    expect(isAbsolutePath('/home/sarah/project/SKILL.md')).toBe(true)
    expect(isAbsolutePath('C:\\Users\\sarah\\project\\SKILL.md')).toBe(true)
    expect(isAbsolutePath('C:/Users/sarah/project/SKILL.md')).toBe(true)
    expect(isAbsolutePath('\\\\server\\share\\project\\SKILL.md')).toBe(true)
    expect(
      isAbsolutePath('node_modules/@tanstack/query/skills/core/SKILL.md'),
    ).toBe(false)
  })

  it('detects package-manager-internal paths', () => {
    expect(
      hasPackageManagerInternalPath(
        'node_modules/.pnpm/@tanstack+query@1.0.0/node_modules/@tanstack/query/skills/core/SKILL.md',
      ),
    ).toBe(true)
    expect(
      hasPackageManagerInternalPath(
        'node_modules\\.bun\\@tanstack-query\\skills\\core\\SKILL.md',
      ),
    ).toBe(true)
    expect(
      hasPackageManagerInternalPath(
        'node_modules/@tanstack/query/skills/core/SKILL.md',
      ),
    ).toBe(false)
  })

  it('allows only stable repo-relative load paths', () => {
    expect(
      isStableLoadPath('node_modules/@tanstack/query/skills/core/SKILL.md'),
    ).toBe(true)
    expect(isStableLoadPath('/home/sarah/project/SKILL.md')).toBe(false)
    expect(isStableLoadPath('../outside/skills/core/SKILL.md')).toBe(false)
    expect(
      isStableLoadPath(
        'node_modules/.pnpm/@tanstack+query@1.0.0/node_modules/@tanstack/query/skills/core/SKILL.md',
      ),
    ).toBe(false)
    expect(isStableLoadPath('\\Users\\sarah\\project\\SKILL.md')).toBe(false)
    expect(isStableLoadPath('')).toBe(false)
  })

  it('rewrites to stable node_modules load paths when a top-level package path exists', () => {
    const root = tempRoot()
    const packageRoot = join(root, 'node_modules', '@tanstack', 'query')
    const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
    mkdirSync(join(packageRoot, 'skills', 'core'), { recursive: true })
    const skills = [skill(skillPath)]

    rewriteSkillLoadPaths({
      packageName: '@tanstack/query',
      packageRoot,
      projectRoot: root,
      skills,
    })

    expect(skills[0]!.path).toBe(
      'node_modules/@tanstack/query/skills/core/SKILL.md',
    )
  })

  it('does not invent stable top-level load paths for pnpm-internal package paths', () => {
    const root = tempRoot()
    const packageRoot = join(
      root,
      'node_modules',
      '.pnpm',
      '@tanstack+query@5.0.0',
      'node_modules',
      '@tanstack',
      'query',
    )
    const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
    mkdirSync(join(packageRoot, 'skills', 'core'), { recursive: true })
    const skills = [skill(skillPath)]

    rewriteSkillLoadPaths({
      packageName: '@tanstack/query',
      packageRoot,
      projectRoot: root,
      skills,
    })

    expect(skills[0]!.path).toContain('node_modules/.pnpm/')
    expect(skills[0]!.path).not.toBe(
      'node_modules/@tanstack/query/skills/core/SKILL.md',
    )
  })

  it('formats runtime lookup guidance without shell-specific tools', () => {
    const target = {
      packageName: '@tanstack/query',
      skillName: 'query-core/fetching',
    }

    const comment = formatRuntimeSkillLookupComment(target)
    const hint = formatRuntimeSkillLookupHint(target)

    expect(comment).toContain(
      'npx @tanstack/intent@latest load @tanstack/query#query-core/fetching --path',
    )
    expect(comment).toContain('Do not copy the resolved path into this file.')
    expect(comment).not.toContain('grep')
    expect(comment).not.toContain('|')
    expect(hint).toBe(`Lookup: ${comment}`)
    expect(isRuntimeSkillLookupComment(comment)).toBe(true)
    expect(isRuntimeSkillLookupComment(`# ${comment}`)).toBe(true)
    expect(
      isRuntimeSkillLookupComment(
        'Runtime lookup only: run `npx @tanstack/intent@latest load foo#bar`.',
      ),
    ).toBe(false)
  })

  it('rewrites to stable node_modules path when pnpEnabled is true', () => {
    const root = tempRoot()
    const packageRoot = join(
      root,
      '.yarn',
      'cache',
      '@tanstack-query-npm-5.0.0.zip',
      'node_modules',
      '@tanstack',
      'query',
    )
    const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
    mkdirSync(join(packageRoot, 'skills', 'core'), { recursive: true })
    const skills = [skill(skillPath)]

    rewriteSkillLoadPaths({
      packageName: '@tanstack/query',
      packageRoot,
      projectRoot: root,
      skills,
      pnpEnabled: true,
    })

    expect(skills[0]!.path).toBe(
      'node_modules/@tanstack/query/skills/core/SKILL.md',
    )
    expect(skills[0]!.path).not.toContain('.yarn')
  })

  it('rewrites to stable node_modules path for unscoped PnP packages', () => {
    const root = tempRoot()
    const packageRoot = join(
      root,
      '.yarn',
      'cache',
      'my-lib-npm-1.0.0.zip',
      'node_modules',
      'my-lib',
    )
    const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
    mkdirSync(join(packageRoot, 'skills', 'core'), { recursive: true })
    const skills = [skill(skillPath)]

    rewriteSkillLoadPaths({
      packageName: 'my-lib',
      packageRoot,
      projectRoot: root,
      skills,
      pnpEnabled: true,
    })

    expect(skills[0]!.path).toBe('node_modules/my-lib/skills/core/SKILL.md')
    expect(skills[0]!.path).not.toContain('.yarn')
  })

  it('prefers node_modules symlink over PnP path when both exist', () => {
    const root = tempRoot()
    const nodeModulesPackageRoot = join(root, 'node_modules', '@tanstack', 'query')
    const pnpPackageRoot = join(
      root,
      '.yarn',
      'cache',
      '@tanstack-query-npm-5.0.0.zip',
      'node_modules',
      '@tanstack',
      'query',
    )
    mkdirSync(nodeModulesPackageRoot, { recursive: true })
    mkdirSync(join(pnpPackageRoot, 'skills', 'core'), { recursive: true })
    const skillPath = join(pnpPackageRoot, 'skills', 'core', 'SKILL.md')
    const skills = [skill(skillPath)]

    rewriteSkillLoadPaths({
      packageName: '@tanstack/query',
      packageRoot: pnpPackageRoot,
      projectRoot: root,
      skills,
      pnpEnabled: true,
    })

    // Should use stable path regardless
    expect(skills[0]!.path).toBe(
      'node_modules/@tanstack/query/skills/core/SKILL.md',
    )
  })

  it('falls back to relative path when pnpEnabled is false and no symlink exists', () => {
    const root = tempRoot()
    const packageRoot = join(
      root,
      '.yarn',
      'cache',
      '@tanstack-query-npm-5.0.0.zip',
      'node_modules',
      '@tanstack',
      'query',
    )
    const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
    mkdirSync(join(packageRoot, 'skills', 'core'), { recursive: true })
    const skills = [skill(skillPath)]

    rewriteSkillLoadPaths({
      packageName: '@tanstack/query',
      packageRoot,
      projectRoot: root,
      skills,
      pnpEnabled: false,
    })

    // Without PnP flag and no symlink, falls back to relative path
    expect(skills[0]!.path).toContain('.yarn')
  })
})

describe('PnP path detection helpers', () => {
  it('detects PnP virtual package paths', () => {
    expect(
      isPnpVirtualPath(
        '.yarn/__virtual__/@tanstack-query-virtual-abc123/0/skills/core/SKILL.md',
      ),
    ).toBe(true)
    expect(
      isPnpVirtualPath(
        'node_modules/@tanstack/query/skills/core/SKILL.md',
      ),
    ).toBe(false)
    expect(
      isPnpVirtualPath(
        '.yarn/cache/@tanstack-query-npm-5.0.0.zip/node_modules/@tanstack/query/skills/core/SKILL.md',
      ),
    ).toBe(false)
  })

  it('detects PnP unplugged package paths', () => {
    expect(
      isPnpUnpluggedPath(
        '.yarn/unplugged/@tanstack-query-npm-5.0.0/node_modules/@tanstack/query/skills/core/SKILL.md',
      ),
    ).toBe(true)
    expect(
      isPnpUnpluggedPath(
        '.yarn/cache/@tanstack-query-npm-5.0.0.zip/node_modules/@tanstack/query/skills/core/SKILL.md',
      ),
    ).toBe(false)
  })

  it('detects PnP cache paths', () => {
    expect(
      isPnpCachePath(
        '.yarn/cache/@tanstack-query-npm-5.0.0.zip/node_modules/@tanstack/query/skills/core/SKILL.md',
      ),
    ).toBe(true)
    expect(
      isPnpCachePath(
        'node_modules/@tanstack/query/skills/core/SKILL.md',
      ),
    ).toBe(false)
    expect(
      isPnpCachePath(
        '.yarn/unplugged/@tanstack-query-npm-5.0.0/node_modules/@tanstack/query/skills/core/SKILL.md',
      ),
    ).toBe(false)
  })
})

describe('PnP warning scenarios', () => {
  it('warns when PnP is enabled but package name is empty', () => {
    const root = tempRoot()
    const skillPath = join(root, 'workspace', 'skills', 'core', 'SKILL.md')
    mkdirSync(join(root, 'workspace', 'skills', 'core'), { recursive: true })
    const skills = [skill(skillPath)]

    const result = rewriteSkillLoadPaths({
      packageName: '',
      packageRoot: join(root, 'workspace'),
      projectRoot: root,
      skills,
      pnpEnabled: true,
    })

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('PnP skill loading requires a package name')
    expect(result.warnings[0]).toContain('Workspace-linked skills outside packages are not supported')
  })

  it('warns when skill is in a PnP virtual package', () => {
    const root = tempRoot()
    const packageRoot = join(
      root,
      '.yarn',
      '__virtual__',
      '@tanstack-query-virtual-abc123',
      '0',
    )
    const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
    mkdirSync(join(packageRoot, 'skills', 'core'), { recursive: true })
    const skills = [skill(skillPath)]

    const result = rewriteSkillLoadPaths({
      packageName: '@tanstack/query',
      packageRoot,
      projectRoot: root,
      skills,
      pnpEnabled: true,
    })

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('PnP virtual package')
    expect(result.warnings[0]).toContain('rewritten to synthetic stable paths')
    expect(result.warnings[0]).not.toContain('npx @tanstack/intent@latest load')
  })

  it('warns when falling back to PnP cache path', () => {
    const root = tempRoot()
    const packageRoot = join(
      root,
      '.yarn',
      'cache',
      '@tanstack-query-npm-5.0.0.zip',
      'node_modules',
      '@tanstack',
      'query',
    )
    const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
    mkdirSync(join(packageRoot, 'skills', 'core'), { recursive: true })
    const skills = [skill(skillPath)]

    // PnP enabled but no stable path (empty package name forces fallback)
    const result = rewriteSkillLoadPaths({
      packageName: '',
      packageRoot,
      projectRoot: root,
      skills,
      pnpEnabled: true,
    })

    // Should have both warnings: missing package name AND cache path
    expect(result.warnings.length).toBeGreaterThanOrEqual(1)
    const cacheWarning = result.warnings.find((w) => w.includes('cache path'))
    expect(cacheWarning).toBeDefined()
    expect(cacheWarning).toContain('may change between installs')
  })

  it('returns no warnings for normal PnP resolution with package name', () => {
    const root = tempRoot()
    const packageRoot = join(
      root,
      '.yarn',
      'cache',
      '@tanstack-query-npm-5.0.0.zip',
      'node_modules',
      '@tanstack',
      'query',
    )
    const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
    mkdirSync(join(packageRoot, 'skills', 'core'), { recursive: true })
    const skills = [skill(skillPath)]

    const result = rewriteSkillLoadPaths({
      packageName: '@tanstack/query',
      packageRoot,
      projectRoot: root,
      skills,
      pnpEnabled: true,
    })

    // Should use stable path and have no warnings
    expect(skills[0]!.path).toBe(
      'node_modules/@tanstack/query/skills/core/SKILL.md',
    )
    expect(result.warnings).toHaveLength(0)
  })

  it('returns no warnings for non-PnP mode', () => {
    const root = tempRoot()
    const packageRoot = join(root, 'node_modules', '@tanstack', 'query')
    const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
    mkdirSync(join(packageRoot, 'skills', 'core'), { recursive: true })
    const skills = [skill(skillPath)]

    const result = rewriteSkillLoadPaths({
      packageName: '@tanstack/query',
      packageRoot,
      projectRoot: root,
      skills,
      pnpEnabled: false,
    })

    expect(skills[0]!.path).toBe(
      'node_modules/@tanstack/query/skills/core/SKILL.md',
    )
    expect(result.warnings).toHaveLength(0)
  })

  it('handles multiple skills with mixed PnP states', () => {
    const root = tempRoot()
    const packageRoot = join(
      root,
      '.yarn',
      '__virtual__',
      '@tanstack-query-virtual-abc123',
      '0',
    )
    const skill1Path = join(packageRoot, 'skills', 'core', 'SKILL.md')
    const skill2Path = join(packageRoot, 'skills', 'cache', 'SKILL.md')
    mkdirSync(join(packageRoot, 'skills', 'core'), { recursive: true })
    mkdirSync(join(packageRoot, 'skills', 'cache'), { recursive: true })
    const skills = [skill(skill1Path), skill(skill2Path)]
    skills[1]!.name = 'cache'

    const result = rewriteSkillLoadPaths({
      packageName: '@tanstack/query',
      packageRoot,
      projectRoot: root,
      skills,
      pnpEnabled: true,
    })

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings.every((w) => w.includes('PnP virtual package'))).toBe(true)
    expect(skills[0]!.path).toBe(
      'node_modules/@tanstack/query/skills/core/SKILL.md',
    )
    expect(skills[1]!.path).toBe(
      'node_modules/@tanstack/query/skills/cache/SKILL.md',
    )
  })

  it('handles deeply nested virtual paths', () => {
    const root = tempRoot()
    const packageRoot = join(
      root,
      '.yarn',
      '__virtual__',
      '@tanstack-query-virtual-abc123',
      '0',
      'node_modules',
      '@tanstack',
      'query',
    )
    const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
    mkdirSync(join(packageRoot, 'skills', 'core'), { recursive: true })
    const skills = [skill(skillPath)]

    const result = rewriteSkillLoadPaths({
      packageName: '@tanstack/query',
      packageRoot,
      projectRoot: root,
      skills,
      pnpEnabled: true,
    })

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('PnP virtual package')
    expect(skills[0]!.path).toBe(
      'node_modules/@tanstack/query/skills/core/SKILL.md',
    )
  })

  it('handles Windows-style virtual paths', () => {
    expect(
      isPnpVirtualPath(
        '.yarn\\__virtual__\\@tanstack-query-virtual-abc123\\0\\skills\\core\\SKILL.md',
      ),
    ).toBe(true)
    expect(
      isPnpVirtualPath(
        '.yarn\\cache\\@tanstack-query-npm-5.0.0.zip\\node_modules\\@tanstack\\query\\skills\\core\\SKILL.md',
      ),
    ).toBe(false)
  })

  it('handles Windows-style cache paths', () => {
    expect(
      isPnpCachePath(
        '.yarn\\cache\\@tanstack-query-npm-5.0.0.zip\\node_modules\\@tanstack\\query\\skills\\core\\SKILL.md',
      ),
    ).toBe(true)
    expect(
      isPnpCachePath(
        'node_modules\\@tanstack\\query\\skills\\core\\SKILL.md',
      ),
    ).toBe(false)
  })

  it('handles Windows-style unplugged paths', () => {
    expect(
      isPnpUnpluggedPath(
        '.yarn\\unplugged\\@tanstack-query-npm-5.0.0\\node_modules\\@tanstack\\query\\skills\\core\\SKILL.md',
      ),
    ).toBe(true)
    expect(
      isPnpUnpluggedPath(
        '.yarn\\cache\\@tanstack-query-npm-5.0.0.zip\\node_modules\\@tanstack\\query\\skills\\core\\SKILL.md',
      ),
    ).toBe(false)
  })

  it('generates combined warnings for complex PnP scenarios', () => {
    const root = tempRoot()
    // Simulate workspace skill (empty package name) in a PnP cache directory
    const packageRoot = join(
      root,
      '.yarn',
      'cache',
      'workspace-pkg.zip',
      'node_modules',
      'workspace-pkg',
    )
    const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
    mkdirSync(join(packageRoot, 'skills', 'core'), { recursive: true })
    const skills = [skill(skillPath)]

    const result = rewriteSkillLoadPaths({
      packageName: '', // Empty package name triggers workspace warning
      packageRoot,
      projectRoot: root,
      skills,
      pnpEnabled: true,
    })

    // Should warn about both empty package name AND cache path
    expect(result.warnings.length).toBeGreaterThanOrEqual(2)
    expect(result.warnings.some((w) => w.includes('requires a package name'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('cache path'))).toBe(true)
  })

  it('does not warn for PnP unplugged packages with valid package name', () => {
    const root = tempRoot()
    const packageRoot = join(
      root,
      '.yarn',
      'unplugged',
      '@tanstack-query-npm-5.0.0',
      'node_modules',
      '@tanstack',
      'query',
    )
    const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
    mkdirSync(join(packageRoot, 'skills', 'core'), { recursive: true })
    const skills = [skill(skillPath)]

    const result = rewriteSkillLoadPaths({
      packageName: '@tanstack/query',
      packageRoot,
      projectRoot: root,
      skills,
      pnpEnabled: true,
    })

    // Should use stable path with no warnings for unplugged
    expect(skills[0]!.path).toBe(
      'node_modules/@tanstack/query/skills/core/SKILL.md',
    )
    expect(result.warnings).toHaveLength(0)
  })
})
