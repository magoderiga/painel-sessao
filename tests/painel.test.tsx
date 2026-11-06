import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'painel-sessao',
  component: 'AbovePrompt',
  props: { hasSurvey: false },
} as const

const PANE = {
  plugin: 'painel-sessao',
  component: 'Pane',
  requestId: 'painel-sessao',
  props: {
    title: 'Painel de sessão',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

type Chamada = { argv: readonly string[]; stdin?: string }

const comecar = async ($: any, on: any, servidores: string[] = ['burp', 'playwright'], salvo?: unknown) => {
  const processos: Chamada[] = []
  const abertos: string[] = []
  let caixa = ''
  let tools = [
    { name: 'Bash', description: 'shell', mcp: false },
    ...servidores.map(s => ({ name: `mcp__${s}__acao`, description: s, mcp: true })),
  ]
  on('store.get', () => ({ value: salvo }))
  on('store.set', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', (_: any, e: any) => {
    abertos.push(e.id)
    return { value: { isPlaced: true } }
  })
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
  on('tool.list', () => ({ value: tools }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  return {
    processos,
    abertos,
    setCaixa: (t: string) => (caixa = t),
    setTools: (lista: typeof tools) => (tools = lista),
  }
}

test('sessao nova comeca com tudo desligado; faixa e uma linha', async ($: any, on: any) => {
  await comecar($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ key: 'memoria' }))?.text).toBe('○ Memória')
    expect((await ui.find({ key: 'claudemd' }))?.text).toBe('○ CLAUDE.md')
    expect((await ui.find({ key: 'mcp' }))?.text).toBe('MCP 0/2')
    expect((await ui.find({ key: 'skills' }))?.text).toBe('Skills 0/3')
    expect((await ui.find({ key: 'voz:auto' }))?.text).toBe('🔇 Auto')
    expect(await ui.find({ key: 'voz:caixa' })).toBeDefined()
    await ui.unmount()
  }
  expect((await $.prompt.section({ name: 'memory', text: 'MEMORIA' })).text).toBeNull()
  const ctx = await $.prompt.context({ blocks: [{ name: 'claudeMd', text: 'x' }, { name: 'currentDate', text: 'hoje' }] })
  expect(ctx.blocks.map((b: any) => b.name)).toEqual(['currentDate'])
  expect((await $.tool.describe({ tool: 'mcp__burp__acao', description: 'x' })).isDeferred).toBe(true)
  expect(String((await $.tool.call({ tool: 'mcp__burp__acao' })).deny)).toContain('burp')
})

test('faixa: toggles de contexto e abrir o painel', async ($: any, on: any) => {
  const { abertos } = await comecar($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'memoria' })
  expect((await ui.find({ key: 'memoria' }))?.text).toBe('● Memória')
  expect((await $.prompt.section({ name: 'memory', text: 'MEMORIA' })).text).toBe('MEMORIA')
  await ui.press({ key: 'mcp' })
  await ui.press({ key: 'skills' })
  expect(abertos).toEqual(['painel-sessao', 'painel-sessao'])
  await ui.unmount()
})

test('painel: skills por grupo, sem builtin nem /l; marcar entra no pedido', async ($: any, on: any) => {
  await comecar($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Minhas$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Anthropic$/ })).toBeDefined()
  expect(await ui.find({ key: 'skill:mago' })).toBeDefined()
  expect(await ui.find({ key: 'skill:pdf' })).toBeDefined()
  expect(await ui.find({ key: 'skill:l' })).toBeUndefined()
  expect(await ui.find({ key: 'skill:help' })).toBeUndefined()

  await ui.press({ key: 'skill:mago' })
  expect((await ui.find({ key: 'skill:mago' }))?.text).toBe('● mago')
  const r = await $.prompt.submit({ text: 'teste o alvo' })
  expect(r.text).toContain('`mago`')
  expect(r.text).toContain('teste o alvo')
  expect((await $.prompt.submit({ text: '/help' })).text).toBe('/help')

  await ui.press({ key: 'limpar' })
  expect((await $.prompt.submit({ text: 'de novo' })).text).toBe('de novo')
  await ui.unmount()
})

test('painel: ligar um servidor MCP libera schema e chamada; todos/nenhum', async ($: any, on: any) => {
  await comecar($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'mcp:burp' })
  expect((await ui.find({ key: 'mcp:burp' }))?.text).toBe('● burp')
  expect((await $.tool.describe({ tool: 'mcp__burp__acao', description: 'x' })).isDeferred).toBeUndefined()
  expect((await $.tool.describe({ tool: 'mcp__playwright__acao', description: 'y' })).isDeferred).toBe(true)
  expect((await $.tool.call({ tool: 'mcp__burp__acao' })).deny).toBeUndefined()
  expect(String((await $.tool.call({ tool: 'mcp__playwright__acao' })).deny)).toContain('playwright')
  await ui.press({ key: 'mcp:todos' })
  expect((await ui.find({ key: 'mcp:playwright' }))?.text).toBe('● playwright')
  await ui.press({ key: 'mcp:nenhum' })
  expect((await ui.find({ key: 'mcp:burp' }))?.text).toBe('○ burp')
  await ui.unmount()
})

test('servidor MCP que conecta depois aparece: via tool.describe e via atualizar', async ($: any, on: any) => {
  const { setTools } = await comecar($, on, [])
  const faixa = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await faixa.find({ key: 'mcp' }))?.text).toBe('MCP 0/0')

  // conectou e o engine descreveu uma ferramenta dele
  await $.tool.describe({ tool: 'mcp__context7__query', description: 'docs' })
  expect((await faixa.find({ key: 'mcp' }))?.text).toBe('MCP 0/1')

  // outro conectou; "atualizar lista" reconsulta tool.list
  setTools([{ name: 'mcp__context7__query', description: 'docs', mcp: true }, { name: 'mcp__fetch__get', description: 'f', mcp: true }])
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'mcp:atualizar' })
  expect(await pane.find({ key: 'mcp:fetch' })).toBeDefined()
  expect((await faixa.find({ key: 'mcp' }))?.text).toBe('MCP 0/2')
  await pane.unmount()
  await faixa.unmount()
})

test('config persistida no store volta na proxima sessao', async ($: any, on: any) => {
  await comecar($, on, ['burp', 'playwright'], { memoria: true, claudeMd: false, mcpLigados: ['burp'], voz: false, velocidade: 1.2 })
  const faixa = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await faixa.find({ key: 'memoria' }))?.text).toBe('● Memória')
  expect((await faixa.find({ key: 'mcp' }))?.text).toBe('MCP 1/2')
  await faixa.unmount()
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await pane.find({ key: 'vel:1.2' }))?.text).toBe('● 1.2x')
  expect((await pane.find({ key: 'vel:1' }))?.text).toBe('○ 1.0x')
  await pane.unmount()
})

test('store antigo (mcpDesligados, sem velocidade) e tolerado', async ($: any, on: any) => {
  await comecar($, on, ['burp'], { memoria: true, claudeMd: true, mcpDesligados: [], voz: false })
  const faixa = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await faixa.find({ key: 'mcp' }))?.text).toBe('MCP 0/1')
  expect((await faixa.find({ key: 'claudemd' }))?.text).toBe('● CLAUDE.md')
  await faixa.unmount()
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await pane.find({ key: 'vel:1' }))?.text).toBe('● 1.0x')
  await pane.unmount()
})

test('ferramentas internas do app nunca sao bloqueadas nem listadas', async ($: any, on: any) => {
  await comecar($, on, [])
  const alvos = ['mcp__ccd_turn__wrap_up', 'mcp__ccd_session__start_session', 'mcp__plugin-authoring__scan_secrets', 'mcp__Claude_Browser__navigate']
  for (const t of alvos) {
    expect((await $.tool.describe({ tool: t, description: 'x' })).isDeferred).toBeUndefined()
    expect((await $.tool.call({ tool: t })).deny).toBeUndefined()
  }
  const faixa = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await faixa.find({ key: 'mcp' }))?.text).toBe('MCP 0/0')
  await faixa.unmount()
})

test('voz: ler a caixa fala o trecho colado sem enviar; velocidade; parar', async ($: any, on: any) => {
  const { processos, setCaixa } = await comecar($, on)
  const faixa = await $.ui.mount({ ...BAND, surface: 'desktop' })

  await faixa.press({ key: 'voz:caixa' })
  expect(processos.length).toBe(0) // caixa vazia: nada falado

  setCaixa('Só este trecho aqui.')
  await faixa.press({ key: 'voz:caixa' })
  expect(processos.length).toBe(1)
  expect(processos[0]!.argv.join(' ')).toMatch(/falar_fila\.py falar --rate \+0% --voz pt-BR-FranciscaNeural$/)
  expect(processos[0]!.stdin).toBe('Só este trecho aqui.')

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'vel:1.5' })
  setCaixa('Mais rápido.')
  await faixa.press({ key: 'voz:caixa' })
  expect(processos[1]!.argv.join(' ')).toMatch(/--rate \+50% --voz pt-BR-FranciscaNeural$/)

  // trocar a voz no painel muda o --voz da proxima fala
  await pane.press({ key: 'voz:nome:pt-BR-AntonioNeural' })
  setCaixa('Com outra voz.')
  await faixa.press({ key: 'voz:caixa' })
  expect(processos[2]!.argv.join(' ')).toMatch(/--rate \+50% --voz pt-BR-AntonioNeural$/)

  await faixa.press({ key: 'voz:parar' })
  expect(processos[processos.length - 1]!.argv.join(' ')).toMatch(/falar_fila\.py parar$/)
  await pane.unmount()
  await faixa.unmount()
})

test('voz: leitura automatica le a resposta ao fim do turno; desligada, nao le', async ($: any, on: any) => {
  const { processos } = await comecar($, on)
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'Resposta lida.', durationMs: 1, isAborted: false })
  expect(processos.length).toBe(0)

  const faixa = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await faixa.press({ key: 'voz:auto' })
  expect((await faixa.find({ key: 'voz:auto' }))?.text).toBe('🔊 Auto')
  await $.turn.complete({ turnId: 't2', reason: 'answer', answer: 'Segunda resposta.', durationMs: 1, isAborted: false })
  const fala = processos.find(p => p.argv.includes('falar'))
  expect(fala?.stdin).toBe('Segunda resposta.')

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'voz:ultima' })
  expect(processos.filter(p => p.argv.includes('falar')).length).toBe(2)
  await pane.unmount()
  await faixa.unmount()
})
