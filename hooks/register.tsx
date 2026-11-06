import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Aba, Catalogo, Config, SkillInfo } from '../types'

const HOOKS_DIR = 'C:/Users/dom/.claude/hooks'
const STORE_KEY = 'config'

// Sessao nova comeca com tudo desligado: voce liga so o que vai usar.
const PADRAO: Config = { memoria: false, claudeMd: false, mcpLigados: [], voz: false }

// Persistido em $.store (entre sessoes); o atom e o espelho lido pelos hooks.
const config = atom({ plugin: 'painel-sessao', key: 'config' } as const, PADRAO, { shape: 'config-2' })
// So desta sessao: skills marcadas para o proximo pedido.
const skills = atom({ plugin: 'painel-sessao', key: 'skills' } as const, [] as string[])
const aba = atom({ plugin: 'painel-sessao', key: 'aba' } as const, 'fechado' as Aba)
const grupoSkills = atom({ plugin: 'painel-sessao', key: 'grupoSkills' } as const, '')
const catalogo = atom({ plugin: 'painel-sessao', key: 'catalogo' } as const, {
  servidores: [],
  skills: [],
} as Catalogo)
const ultimaResposta = atom({ plugin: 'painel-sessao', key: 'ultimaResposta' } as const, '')

const servidorDe = (tool: string): string | null =>
  tool.startsWith('mcp__') ? tool.slice(5).split('__')[0] ?? null : null

const SKILLS_OCULTAS = new Set(['l', 'l-0', 'painel'])
const GRUPO_MEUS = 'Minhas'

const PY_FALAR = [
  'import sys',
  `sys.path.insert(0, r'${HOOKS_DIR}')`,
  'import falar_resposta as f',
  "t = sys.stdin.buffer.read().decode('utf-8', 'replace')",
  't = f.limpar(t)',
  'f.falar(t) if t.strip() else None',
].join('; ')

const PY_CALAR = [
  'import sys, subprocess',
  `sys.path.insert(0, r'${HOOKS_DIR}')`,
  'import falar_resposta as f',
  'p = f.PID',
  "subprocess.run(['taskkill', '/F', '/T', '/PID', p.read_text().strip()], capture_output=True) if p.exists() else None",
].join('; ')

async function salvar($: EngineInterface, fn: (c: Config) => Config) {
  const novo = await update($, config, fn)
  await $.store.set(STORE_KEY, novo)
  return novo
}

async function falar($: EngineInterface, texto: string) {
  if (!texto.trim()) return
  try {
    const r = await $.process.run(['python', '-c', PY_FALAR], { stdin: texto, timeoutMs: 20000 })
    if (r.exitCode !== 0) $.ui.toast(`Voz: falha (${r.stderr.trim().slice(-120)})`)
  } catch (err) {
    $.ui.toast(`Voz: ${String(err).slice(0, 120)}`)
  }
}

async function calar($: EngineInterface) {
  try {
    await $.process.run(['python', '-c', PY_CALAR], { timeoutMs: 10000 })
  } catch {
    // nada tocando
  }
}

function grupoDe(c: { source: string; plugin?: string }): string {
  if (c.source === 'user') return GRUPO_MEUS
  if (c.source === 'plugin') return (c.plugin ?? 'plugin').replace(/^anthropic-skills$/, 'Anthropic')
  return c.source
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const salvo = (await $.store.get(STORE_KEY)) as Partial<Config> | undefined
    if (salvo && typeof salvo === 'object') {
      await update($, config, () => ({
        ...PADRAO,
        memoria: salvo.memoria === true,
        claudeMd: salvo.claudeMd === true,
        voz: salvo.voz === true,
        mcpLigados: Array.isArray(salvo.mcpLigados) ? salvo.mcpLigados.filter(s => typeof s === 'string') : [],
      }))
    }

    const tools = await $.tool.list()
    const servidores = [...new Set(tools.map(t => servidorDe(t.name)).filter((s): s is string => !!s))].sort()

    const comandos = await $.command.list()
    const lista: SkillInfo[] = comandos
      .filter(c => c.source !== 'builtin' && c.source !== 'mcp' && !SKILLS_OCULTAS.has(c.name))
      .map(c => ({ name: c.name, description: c.description, grupo: grupoDe(c) }))
      .sort((a, b) => a.grupo.localeCompare(b.grupo) || a.name.localeCompare(b.name))

    await update($, catalogo, () => ({ servidores, skills: lista }))
    await update($, grupoSkills, atual => atual || (lista.some(s => s.grupo === GRUPO_MEUS) ? GRUPO_MEUS : lista[0]?.grupo ?? ''))

    await $.command.register({
      name: 'painel',
      description: 'Mostra/oculta a faixa do painel de sessao acima do prompt',
    })

    return next(e)
  })

  on('command.run', { command: 'painel' }, async $ => {
    const atual = await read($, aba)
    await update($, aba, () => (atual === 'oculto' ? 'fechado' : 'oculto'))
    return { text: atual === 'oculto' ? 'Painel visivel.' : 'Painel oculto.' }
  })

  // Memoria automatica: secao "memory" do system prompt.
  on('prompt.section', { name: 'memory' }, async ($, e, next) => {
    const c = await read($, config)
    return c.memoria ? next(e) : { text: null }
  })

  // CLAUDE.md e arquivos de instrucao: bloco claudeMd do contexto.
  on('prompt.context', async ($, e, next) => {
    const c = await read($, config)
    if (c.claudeMd) return next(e)
    return next({ ...e, blocks: e.blocks.filter(b => b.name !== 'claudeMd') })
  })

  // Servidor MCP desligado: schema fica fora do prompt (so atras do ToolSearch).
  on('tool.describe', async ($, e, next) => {
    const s = servidorDe(e.tool)
    if (!s) return next(e)
    const c = await read($, config)
    if (c.mcpLigados.includes(s)) return next(e)
    return { description: e.description, isDeferred: true }
  })

  // ...e qualquer chamada a ele e negada.
  on('tool.call', async ($, e, next) => {
    const s = servidorDe(e.tool)
    if (!s) return next(e)
    const c = await read($, config)
    if (c.mcpLigados.includes(s)) return next(e)
    return { deny: `Servidor MCP "${s}" esta desligado no painel de sessao (ligue-o na faixa acima do prompt).` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'painel-sessao: falha ao avaliar o servidor' }))

  // Skills marcadas entram como instrucao no inicio do pedido.
  on('prompt.submit', async ($, e, next) => {
    const marcadas = await read($, skills)
    if (marcadas.length === 0 || e.text.trimStart().startsWith('/')) return next(e)
    const nomes = marcadas.map(n => `\`${n}\``).join(', ')
    const texto =
      `[painel-sessao] Antes de responder, invoque com a ferramenta Skill ` +
      `${marcadas.length === 1 ? 'a skill' : 'as skills'} ${nomes} e siga suas instrucoes para o pedido abaixo.\n\n${e.text}`
    return next({ ...e, text: texto })
  })

  // Voz: guarda a ultima resposta e, se ligada, le em voz alta.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId || e.reason !== 'answer') return r
    const resposta = e.answer ?? ''
    if (!resposta.trim()) return r
    await update($, ultimaResposta, () => resposta)
    const c = await read($, config)
    if (c.voz) void falar($, resposta)
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const estado = await read($, aba)
    const { Box, Button, Text } = $.ui.resolve(e)

    if (estado === 'oculto') {
      return (
        <Box>
          <Button key="mostrar" label="Painel" onPress={() => update($, aba, () => 'fechado')} />
        </Box>
      )
    }

    const c = await read($, config)
    const marcadas = await read($, skills)
    const cat = await read($, catalogo)
    const grupo = await read($, grupoSkills)
    const marca = (v: boolean) => (v ? '✓' : '✗')
    const seta = (qual: Aba) => (estado === qual ? '▴' : '▾')

    const alternarMemoria = async () => {
      await salvar($, x => ({ ...x, memoria: !x.memoria }))
      $.ui.invalidate('prompt.section')
    }
    const alternarClaudeMd = async () => {
      await salvar($, x => ({ ...x, claudeMd: !x.claudeMd }))
      $.ui.invalidate('prompt.context')
    }
    const definirServidores = async (lista: string[]) => {
      await salvar($, x => ({ ...x, mcpLigados: lista }))
      $.ui.invalidate('tool.describe')
    }
    const alternarServidor = (s: string) =>
      definirServidores(c.mcpLigados.includes(s) ? c.mcpLigados.filter(n => n !== s) : [...c.mcpLigados, s])
    const alternarSkill = (n: string) =>
      update($, skills, lista => (lista.includes(n) ? lista.filter(x => x !== n) : [...lista, n]))
    const alternarVoz = async () => {
      const novo = await salvar($, x => ({ ...x, voz: !x.voz }))
      if (novo.voz) {
        const ultima = await read($, ultimaResposta)
        if (ultima.trim()) void falar($, ultima)
        else $.ui.toast('Voz ligada: a proxima resposta sera lida.')
      } else {
        void calar($)
      }
    }
    const abrir = (qual: Aba) => update($, aba, atual => (atual === qual ? 'fechado' : qual))

    const ligadosCtx = Number(c.memoria) + Number(c.claudeMd)
    const ligadosMcp = c.mcpLigados.filter(s => cat.servidores.includes(s)).length
    const grupos = [...new Set(cat.skills.map(s => s.grupo))]
    const skillsDoGrupo = cat.skills.filter(s => s.grupo === grupo)

    return (
      <Box flexDirection="column" gap={0}>
        <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
          <Text dimColor>Painel</Text>
          <Button key="contexto" label={`Contexto ${ligadosCtx}/2 ${seta('contexto')}`} onPress={() => abrir('contexto')} />
          <Button key="mcp" label={`MCP ${ligadosMcp}/${cat.servidores.length} ${seta('mcp')}`} onPress={() => abrir('mcp')} />
          <Button
            key="skills"
            label={`Skills ${marcadas.length}/${cat.skills.length} ${seta('skills')}`}
            onPress={() => abrir('skills')}
          />
          <Button key="voz" label={`${c.voz ? '🔊 Voz ligada' : '🔇 Voz'}`} onPress={alternarVoz} />
          <Button key="ocultar" label="×" onPress={() => update($, aba, () => 'oculto')} />
        </Box>

        {estado === 'contexto' && (
          <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
            <Text dimColor>Contexto:</Text>
            <Button key="memoria" label={`${marca(c.memoria)} Memória automática`} onPress={alternarMemoria} />
            <Button key="claudemd" label={`${marca(c.claudeMd)} CLAUDE.md e regras`} onPress={alternarClaudeMd} />
          </Box>
        )}

        {estado === 'mcp' && (
          <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
            <Text dimColor>MCP:</Text>
            {cat.servidores.length === 0 && <Text dimColor>nenhum servidor conectado</Text>}
            {cat.servidores.map(s => (
              <Button key={`mcp:${s}`} label={`${marca(c.mcpLigados.includes(s))} ${s}`} onPress={() => alternarServidor(s)} />
            ))}
            {cat.servidores.length > 0 && (
              <Button key="mcp:todos" label="todos" onPress={() => definirServidores([...cat.servidores])} />
            )}
            {cat.servidores.length > 0 && <Button key="mcp:nenhum" label="nenhum" onPress={() => definirServidores([])} />}
          </Box>
        )}

        {estado === 'skills' && (
          <Box flexDirection="column">
            <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
              <Text dimColor>Origem:</Text>
              {grupos.map(g => (
                <Button
                  key={`grupo:${g}`}
                  label={`${g === grupo ? '●' : '○'} ${g}`}
                  onPress={() => update($, grupoSkills, () => g)}
                />
              ))}
            </Box>
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {cat.skills.length === 0 && <Text dimColor>nenhuma skill encontrada</Text>}
              {skillsDoGrupo.map(s => (
                <Button
                  key={`skill:${s.name}`}
                  label={`${marcadas.includes(s.name) ? '☑' : '☐'} ${s.name}`}
                  onPress={() => alternarSkill(s.name)}
                />
              ))}
            </Box>
            {marcadas.length > 0 && (
              <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
                <Text dimColor>No próximo pedido:</Text>
                <Text>{marcadas.join(', ')}</Text>
                <Button key="limpar" label="limpar" onPress={() => update($, skills, () => [])} />
              </Box>
            )}
          </Box>
        )}
      </Box>
    )
  })
}
