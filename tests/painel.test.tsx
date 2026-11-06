import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'painel-sessao',
  component: 'AbovePrompt',
  props: { hasSurvey: false },
} as const

type Chamada = { argv: readonly string[]; stdin?: string }

const comecar = async ($: any, on: any, servidores: string[] = ['burp', 'playwright'], salvo?: unknown) => {
  const processos: Chamada[] = []
  let caixa = ''
  on('store.get', () => ({ value: salvo }))
  on('store.set', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: caixa, cursor: caixa.length } }))
  on('process.run', (_: any, e: any) => {
    processos.push({ argv: e.argv, stdin: e.init?.stdin })
    return { value: { exitCode: 0, stdout: 'ok', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  on('prompt.section', (_: any, e: any) => ({ text: e.text }))
  on('prompt.context', (_: any, e: any) => ({ blocks: e.blocks }))
  on('tool.describe', (_: any, e: any) => ({ description: e.description }))
  on('tool.call', () => ({ result: 'rodou' }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('command.register', () => ({ value: { command: 'painel' } }))
  on('command.list', () => ({
    value: [
      { name: 'help', description: 'ajuda', source: 'builtin' },
      { name: 'l', description: 'voz', source: 'user' },
      { name: 'mago', description: 'pentest', source: 'user' },
      { name: 'anticaptcha', description: 'captcha', source: 'user' },
      { name: 'pdf', description: 'pdf', source: 'plugin', plugin: 'anthropic-skills' },
    ],
  }))
  on('tool.list', () => ({
    value: [
      { name: 'Bash', description: 'shell', mcp: false },
      ...servidores.map(s => ({ name: `mcp__${s}__acao`, description: s, mcp: true })),
    ],
  }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  return { processos, setCaixa: (t: string) => (caixa = t) }
}

const abrirSe = async (ui: any, key: string) => {
  if (/▾/.test((await ui.find({ key }))?.text ?? '')) await ui.press({ key })
}

test('sessao nova comeca com tudo desligado', async ($: any, on: any) => {
  await comecar($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ key: 'contexto' }))?.text).toBe('Contexto 0/2 ▾')
    expect((await ui.find({ key: 'mcp' }))?.text).toBe('MCP 0/2 ▾')
    expect((await ui.find({ key: 'skills' }))?.text).toBe('Skills 0/3 ▾')
    expect((await ui.find({ key: 'voz' }))?.text).toBe('🔇 Voz ▾')
    await ui.unmount()
  }
  expect((await $.prompt.section({ name: 'memory', text: 'MEMORIA' })).text).toBeNull()
  const ctx = await $.prompt.context({ blocks: [{ name: 'claudeMd', text: 'x' }, { name: 'currentDate', text: 'hoje' }] })
  expect(ctx.blocks.map((b: any) => b.name)).toEqual(['currentDate'])
  expect((await $.tool.describe({ tool: 'mcp__burp__acao', description: 'x' })).isDeferred).toBe(true)
  expect(String((await $.tool.call({ tool: 'mcp__burp__acao' })).deny)).toContain('burp')
})

test('skills agrupadas por origem, sem builtin nem /l', async ($: any, on: any) => {
  await comecar($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await abrirSe(ui, 'skills')
  expect(await ui.find({ key: 'grupo:Minhas' })).toBeDefined()
  expect(await ui.find({ key: 'grupo:Anthropic' })).toBeDefined()
  expect(await ui.find({ key: 'skill:mago' })).toBeDefined()
  expect(await ui.find({ key: 'skill:pdf' })).toBeUndefined()
  expect(await ui.find({ key: 'skill:l' })).toBeUndefined()
  expect(await ui.find({ key: 'skill:help' })).toBeUndefined()
  await ui.press({ key: 'grupo:Anthropic' })
  expect(await ui.find({ key: 'skill:pdf' })).toBeDefined()
  expect(await ui.find({ key: 'skill:mago' })).toBeUndefined()
  await ui.unmount()
})

test('skill marcada entra no inicio do pedido; comando / passa intacto', async ($: any, on: any) => {
  await comecar($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await abrirSe(ui, 'skills')
  await ui.press({ key: 'skill:mago' })
  expect((await ui.find({ key: 'skills' }))?.text).toBe('Skills 1/3 ▴')
  expect((await ui.find({ key: 'skill:mago' }))?.text).toMatch(/^● mago/)

  const r = await $.prompt.submit({ text: 'teste o alvo' })
  expect(r.text).toContain('`mago`')
  expect(r.text).toContain('teste o alvo')
  expect((await $.prompt.submit({ text: '/help' })).text).toBe('/help')

  await ui.press({ key: 'limpar' })
  expect((await $.prompt.submit({ text: 'de novo' })).text).toBe('de novo')
  await ui.unmount()
})

test('ligar memoria e CLAUDE.md devolve ambos ao prompt', async ($: any, on: any) => {
  await comecar($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await abrirSe(ui, 'contexto')
  await ui.press({ key: 'memoria' })
  await ui.press({ key: 'claudemd' })
  expect((await ui.find({ key: 'contexto' }))?.text).toBe('Contexto 2/2 ▴')
  expect((await $.prompt.section({ name: 'memory', text: 'MEMORIA' })).text).toBe('MEMORIA')
  const ctx = await $.prompt.context({ blocks: [{ name: 'claudeMd', text: 'x' }] })
  expect(ctx.blocks.map((b: any) => b.name)).toEqual(['claudeMd'])
  await ui.press({ key: 'memoria' })
  expect((await $.prompt.section({ name: 'memory', text: 'MEMORIA' })).text).toBeNull()
  await ui.unmount()
})

test('ligar um servidor MCP libera schema e chamada; todos/nenhum', async ($: any, on: any) => {
  await comecar($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await abrirSe(ui, 'mcp')
  await ui.press({ key: 'mcp:burp' })
  expect((await ui.find({ key: 'mcp' }))?.text).toBe('MCP 1/2 ▴')
  expect((await $.tool.describe({ tool: 'mcp__burp__acao', description: 'x' })).isDeferred).toBeUndefined()
  expect((await $.tool.describe({ tool: 'mcp__playwright__acao', description: 'y' })).isDeferred).toBe(true)
  expect((await $.tool.call({ tool: 'mcp__burp__acao' })).deny).toBeUndefined()
  expect(String((await $.tool.call({ tool: 'mcp__playwright__acao' })).deny)).toContain('playwright')
  await ui.press({ key: 'mcp:todos' })
  expect((await ui.find({ key: 'mcp' }))?.text).toBe('MCP 2/2 ▴')
  await ui.press({ key: 'mcp:nenhum' })
  expect((await ui.find({ key: 'mcp' }))?.text).toBe('MCP 0/2 ▴')
  await ui.unmount()
})

test('config persistida no store volta na proxima sessao', async ($: any, on: any) => {
  await comecar($, on, ['burp', 'playwright'], { memoria: true, claudeMd: false, mcpLigados: ['burp'], voz: false, velocidade: 1.2 })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ key: 'contexto' }))?.text).toBe('Contexto 1/2 ▾')
  expect((await ui.find({ key: 'mcp' }))?.text).toBe('MCP 1/2 ▾')
  await abrirSe(ui, 'voz')
  expect((await ui.find({ key: 'vel:1.2' }))?.text).toBe('● 1.2x')
  expect((await ui.find({ key: 'vel:1' }))?.text).toBe('○ 1.0x')
  await ui.unmount()
})

test('store antigo (mcpDesligados, sem velocidade) e tolerado', async ($: any, on: any) => {
  await comecar($, on, ['burp'], { memoria: true, claudeMd: true, mcpDesligados: [], voz: false })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ key: 'mcp' }))?.text).toBe('MCP 0/1 ▾')
  expect((await ui.find({ key: 'contexto' }))?.text).toBe('Contexto 2/2 ▾')
  await abrirSe(ui, 'voz')
  expect((await ui.find({ key: 'vel:1' }))?.text).toBe('● 1.0x')
  await ui.unmount()
})

test('ferramentas internas do app nunca sao bloqueadas', async ($: any, on: any) => {
  await comecar($, on)
  const alvos = ['mcp__ccd_turn__wrap_up', 'mcp__ccd_session__start_session', 'mcp__plugin-authoring__scan_secrets', 'mcp__Claude_Browser__navigate']
  for (const t of alvos) {
    expect((await $.tool.describe({ tool: t, description: 'x' })).isDeferred).toBeUndefined()
    expect((await $.tool.call({ tool: t })).deny).toBeUndefined()
  }
})

test('voz: ler a caixa fala o texto colado sem enviar; parar chama o script', async ($: any, on: any) => {
  const { processos, setCaixa } = await comecar($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await abrirSe(ui, 'voz')

  await ui.press({ key: 'voz:caixa' })
  expect(processos.length).toBe(0) // caixa vazia: nada falado

  setCaixa('Só este trecho aqui.')
  await ui.press({ key: 'voz:caixa' })
  expect(processos.length).toBe(1)
  expect(processos[0]!.argv.join(' ')).toMatch(/falar_fila\.py falar --rate \+0%$/)
  expect(processos[0]!.stdin).toBe('Só este trecho aqui.')

  await ui.press({ key: 'vel:1.5' })
  setCaixa('Mais rápido.')
  await ui.press({ key: 'voz:caixa' })
  expect(processos[1]!.argv.join(' ')).toMatch(/--rate \+50%$/)

  await ui.press({ key: 'voz:parar' })
  expect(processos[processos.length - 1]!.argv.join(' ')).toMatch(/falar_fila\.py parar$/)
  await ui.unmount()
})

test('voz: leitura automatica le a resposta ao fim do turno; desligada, nao le', async ($: any, on: any) => {
  const { processos } = await comecar($, on)
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'Resposta lida.', durationMs: 1, isAborted: false })
  expect(processos.length).toBe(0)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await abrirSe(ui, 'voz')
  await ui.press({ key: 'voz:auto' })
  expect((await ui.find({ key: 'voz' }))?.text).toBe('🔊 Voz ▴')
  await $.turn.complete({ turnId: 't2', reason: 'answer', answer: 'Segunda resposta.', durationMs: 1, isAborted: false })
  const fala = processos.find(p => p.argv.includes('falar'))
  expect(fala?.stdin).toBe('Segunda resposta.')

  await ui.press({ key: 'voz:ultima' })
  expect(processos.filter(p => p.argv.includes('falar')).length).toBe(2)
  await ui.unmount()
})
