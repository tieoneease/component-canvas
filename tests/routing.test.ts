import { describe, expect, it } from 'vitest'

import {
  overviewHash,
  parseRoute,
  previewScreenSrc,
  previewVariantSrc,
  screenHash,
  variantHash,
  workflowHash
} from '../shell-src/src/lib/routing.js'

describe('routing helpers', () => {
  it('encodes variant routes consistently', () => {
    expect(variantHash('Marketing / Onboarding', 'dense & spacious')).toBe(
      '#/variant/Marketing%20%2F%20Onboarding/dense%20%26%20spacious'
    )
  })

  it('builds preview variant URLs from the variant hash', () => {
    expect(previewVariantSrc('workflow/one', 'variant two')).toBe(
      '/preview/#/variant/workflow%2Fone/variant%20two'
    )
  })

  it('matches and decodes variant routes', () => {
    expect(parseRoute('#/variant/Marketing%20%2F%20Onboarding/dense%20%26%20spacious')).toEqual({
      type: 'variant',
      workflowId: 'Marketing / Onboarding',
      variantId: 'dense & spacious'
    })
  })

  it('keeps existing overview, workflow, and screen routes working', () => {
    expect(parseRoute(overviewHash())).toEqual({ type: 'overview' })
    expect(parseRoute(workflowHash('Primary Flow'))).toEqual({
      type: 'workflow',
      workflowId: 'Primary Flow'
    })
    expect(parseRoute(screenHash('Primary Flow', 'Account / Settings'))).toEqual({
      type: 'screen',
      workflowId: 'Primary Flow',
      screenId: 'Account / Settings'
    })
    expect(previewScreenSrc('Primary Flow', 'Account / Settings')).toBe(
      '/preview/#/screen/Primary%20Flow/Account%20%2F%20Settings'
    )
  })
})
