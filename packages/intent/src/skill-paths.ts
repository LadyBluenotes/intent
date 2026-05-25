import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { toPosixPath } from './utils.js'
import type { SkillUse } from './skill-use.js'
import type { SkillEntry } from './types.js'

const RUNTIME_SKILL_LOOKUP_COMMENT_PATTERN =
  /^Runtime lookup only: run `npx @tanstack\/intent@latest load [^`]+ --path`, and load its reported path for this session\. Do not copy the resolved path into this file\.$/

export function isAbsolutePath(path: string): boolean {
  return (
    path.startsWith('/') ||
    path.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(path)
  )
}

function getPathSegments(path: string): Array<string> {
  return path.replace(/\\/g, '/').split('/')
}

function isPackageManagerInternalSegment(segment: string): boolean {
  return segment === '.pnpm' || segment === '.bun' || segment === '.yarn'
}

export function hasPackageManagerInternalPath(path: string): boolean {
  return getPathSegments(path).some(isPackageManagerInternalSegment)
}

export function isStableLoadPath(path: string): boolean {
  const normalized = path.trim()
  const segments = getPathSegments(normalized)
  return (
    normalized !== '' &&
    !isAbsolutePath(normalized) &&
    !segments.includes('..') &&
    !segments.some(isPackageManagerInternalSegment)
  )
}

export interface RewriteSkillLoadPathsResult {
  warnings: Array<string>
}

export function isPnpVirtualPath(path: string): boolean {
  const segments = getPathSegments(path)
  return segments.some((seg) => seg === '__virtual__')
}

export function isPnpUnpluggedPath(path: string): boolean {
  const segments = getPathSegments(path)
  return segments.some((seg) => seg === 'unplugged')
}

export function isPnpCachePath(path: string): boolean {
  const segments = getPathSegments(path)
  const yarnIndex = segments.indexOf('.yarn')
  return yarnIndex !== -1 && segments[yarnIndex + 1] === 'cache'
}

export function rewriteSkillLoadPaths({
  packageName,
  packageRoot,
  projectRoot,
  skills,
  pnpEnabled = false,
}: {
  packageName: string
  packageRoot: string
  projectRoot: string
  skills: Array<SkillEntry>
  pnpEnabled?: boolean
}): RewriteSkillLoadPathsResult {
  const warnings: Array<string> = []
  const hasStableSymlink =
    packageName !== '' &&
    existsSync(join(projectRoot, 'node_modules', packageName))

  const useStablePath = hasStableSymlink || (pnpEnabled && packageName !== '')
  let warnedVirtualPath = false

  if (pnpEnabled && packageName === '') {
    warnings.push(
      'PnP skill loading requires a package name. Workspace-linked skills outside packages are not supported in PnP mode. Falling back to runtime-only path resolution.',
    )
  }

  for (const skill of skills) {
    if (pnpEnabled && isPnpVirtualPath(skill.path) && !warnedVirtualPath) {
      warnedVirtualPath = true
      warnings.push(
        `Package "${packageName || 'unknown'}" is in a PnP virtual package. Skill paths were rewritten to synthetic stable paths for load references; those paths may not exist on disk.`,
      )
    }

    if (useStablePath) {
      const relFromPackage = toPosixPath(relative(packageRoot, skill.path))
      skill.path = `node_modules/${packageName}/${relFromPackage}`
    } else {
      const relativePath = toPosixPath(relative(projectRoot, skill.path))
      skill.path = relativePath

      if (pnpEnabled && isPnpCachePath(relativePath)) {
        warnings.push(
          `Skill "${skill.name}" resolved to a PnP cache path which may change between installs. Consider using runtime path resolution with \`npx @tanstack/intent@latest load ${packageName || 'package'}#${skill.name} --path\`.`,
        )
      }
    }
  }

  return { warnings }
}

export function formatRuntimeSkillLookupComment(target: SkillUse): string {
  return `Runtime lookup only: run \`npx @tanstack/intent@latest load ${target.packageName}#${target.skillName} --path\`, and load its reported path for this session. Do not copy the resolved path into this file.`
}

export function isRuntimeSkillLookupComment(value: string): boolean {
  const comment = value.trim().replace(/^#\s*/, '')
  return RUNTIME_SKILL_LOOKUP_COMMENT_PATTERN.test(comment)
}

export function formatRuntimeSkillLookupHint(target: SkillUse): string {
  return `Lookup: ${formatRuntimeSkillLookupComment(target)}`
}
