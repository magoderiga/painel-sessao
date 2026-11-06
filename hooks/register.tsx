import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Aba, Catalogo, Config, SkillInfo } from '../types'

const STORE_KEY = 'config'

// Sessao nova comeca com tudo desligado: voce liga so o que vai usar.
const PADRAO: Config = { memoria: false, claudeMd: false, mcpLigados: [], voz: false, velocidade: 1 }
const VELOCIDADES = [0.8, 1, 1.2, 1.5]

// Persistido em $.store (entre sessoes); o atom e o espelho lido pelos hooks.
const config = atom({ plugin: 'painel-sessao', key: 'config' } as const, PADRAO, { shape: 'config-3' })
// So desta sessao: skills marcadas para o proximo pedido.
const skills = atom({ plugin: 'painel-sessao', key: 'skills' } as const, [] as string[])
const aba = atom({ plugin: 'painel-sessao', key: 'aba' } as const, 'fechado' as Aba)
const grupoSkills = atom({ plugin: 'painel-sessao', key: 'grupoSkills' } as const, '')
const catalogo = atom({ plugin: 'painel-sessao', key: 'catalogo' } as const, {
  servidores: [],
  skills: [],
} as Catalogo)
const ultimaResposta = atom({ plugin: 'painel-sessao', key: 'ultimaResposta' } as const, '')

// Infra do proprio app e do dev de mods: nunca entra no painel nem e bloqueada,
// senao o mod derrubaria ferramentas internas (ccd_*, autoria de mods, navegador).
const INFRA = ['ccd_', 'plugin-authoring', 'Claude_Browser', 'remote-devices', 'computer-use', 'visualize', 'terminal']
const ehInfra = (s: string): boolean => INFRA.some(p => s === p || s.startsWith(p))

const servidorDe = (tool: string): string | null => {
  if (!tool.startsWith('mcp__')) return null
  const s = tool.slice(5).split('__')[0] ?? null
  return s && !ehInfra(s) ? s : null
}

const SKILLS_OCULTAS = new Set(['l', 'l-0', 'painel'])
const GRUPO_MEUS = 'Minhas'

const rateDe = (v: number): string => {
  const pct = Math.round((v - 1) * 100)
  return `${pct >= 0 ? '+' : ''}${pct}%`
}

async function salvar($: EngineInterface, fn: (c: Config) => Config) {
  const novo = await update($, config, fn)
  await $.store.set(STORE_KEY, novo)
  return novo
}

function scriptVoz($: EngineInterface): string {
  return `${$.plugin.root}/scripts/falar_fila.py`
}

async function falar($: EngineInterface, texto: string, velocidade: number) {
  if (!texto.trim()) return
  try {
    const r = await $.process.run(['python', scriptVoz($), 'falar', '--rate', rateDe(velocidade)], {
      stdin: texto,
      timeoutMs: 30000,
    })
    if (r.exitCode !== 0) $.ui.toast(`Voz: falha (${(r.stderr || r.stdout).trim().slice(-140)})`)
  } catch (err) {
    $.ui.toast(`Voz: ${String(err).slice(0, 140)}`)
  }
}

async function parar($: EngineInterface) {
  try {
    await $.process.run(['python', scriptVoz($), 'parar'], { timeoutMs: 15000 })
  } catch {
    // nada tocando
  }
}

function grupoDe(c: { source: string; plugin?: string }): string {
  if (c.source === 'user') return GRUPO_MEUS
  if (c.source === 'plugin') return (c.plugin ?? 'plugin').replace(/^anthropic-skills$/, 'Anthropic')
  return c.source
}

type Item = { key: string; nome: string; marcado: boolean; onPress: () => unknown }

function colunas<T>(lista: T[], n: number): T[][] {
  const porColuna = Math.ceil(lista.length / n) || 1
  const saida: T[][] = []
  for (let i = 0; i < lista.length; i += porColuna) saida.push(lista.slice(i, i + porColuna))
  return saida
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const salvo = (await $.store.get(STORE_KEY)) as Partial<Config> | undefined
    if (salvo && typeof salvo === 'object') {
      const v = Number(salvo.velocidade)
      await update($, config, () => ({
        ...PADRAO,
        memoria: salvo.memoria === true,
        claudeMd: salvo.claudeMd === true,
        voz: salvo.voz === true,
        velocidade: VELOCIDADES.includes(v) ? v : 1,
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

  // Voz: guarda a ultima resposta e, se a leitura automatica estiver ligada, le.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId || e.reason !== 'answer') return r
    const resposta = e.answer ?? ''
    if (!resposta.trim()) return r
    await update($, ultimaResposta, () => resposta)
    const c = await read($, config)
    if (c.voz) void falar($, resposta, c.velocidade)
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const estado = await read($, aba)
    const { Box, Button, Text } = $.ui.resolve(e)

    if (estado === 'oculto') {
      return (
        <Box>
          <Button key="mostrar" label="Painel" plain dimColor onPress={() => update($, aba, () => 'fechado')} />
        </Box>
      )
    }

    const c = await read($, config)
    const marcadas = await read($, skills)
    const cat = await read($, catalogo)
    const grupo = await read($, grupoSkills)
    const nCols = e.surface === 'desktop' ? 4 : e.surface === 'terminal' ? 3 : 2
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
    const alternarAuto = async () => {
      const novo = await salvar($, x => ({ ...x, voz: !x.voz }))
      if (!novo.voz) void parar($)
      else $.ui.toast('Leitura automatica ligada: cada resposta nova sera lida.')
    }
    const lerCaixa = async () => {
      const { text } = await $.prompt.read()
      if (!text.trim()) {
        $.ui.toast('Cole na caixa o trecho que quer ouvir e clique de novo.')
        return
      }
      void falar($, text, c.velocidade)
    }
    const lerUltima = async () => {
      const ultima = await read($, ultimaResposta)
      if (!ultima.trim()) {
        $.ui.toast('Ainda nao ha resposta nesta sessao.')
        return
      }
      void falar($, ultima, c.velocidade)
    }
    const definirVelocidade = (v: number) => salvar($, x => ({ ...x, velocidade: v }))
    const abrir = (qual: Aba) => update($, aba, atual => (atual === qual ? 'fechado' : qual))

    const ligadosCtx = Number(c.memoria) + Number(c.claudeMd)
    const ligadosMcp = c.mcpLigados.filter(s => cat.servidores.includes(s)).length
    const grupos = [...new Set(cat.skills.map(s => s.grupo))]
    const skillsDoGrupo = cat.skills.filter(s => s.grupo === grupo)

    // Grade: colunas alinhadas, botoes sem moldura; marcado em cor cheia, resto esmaecido.
    const grade = (itens: Item[]) => (
      <Box flexDirection="row" columnGap={3}>
        {colunas(itens, nCols).map((col, ci) => {
          const largura = Math.max(...col.map(i => i.nome.length))
          return (
            <Box key={`col${ci}`} flexDirection="column">
              {col.map(i => (
                <Button
                  key={i.key}
                  plain
                  dimColor={!i.marcado}
                  label={`${i.marcado ? '●' : '○'} ${i.nome.padEnd(largura)}`}
                  onPress={i.onPress}
                />
              ))}
            </Box>
          )
        })}
      </Box>
    )

    const secao = (titulo: string, filho: RenderChildren, rodape?: RenderChildren) => (
      <Box flexDirection="column" paddingLeft={1} paddingY={0} borderStyle="single" borderDimColor>
        <Text dimColor>{titulo}</Text>
        {filho}
        {rodape}
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
          <Text dimColor>Painel</Text>
          <Button key="contexto" label={`Contexto ${ligadosCtx}/2 ${seta('contexto')}`} onPress={() => abrir('contexto')} />
          <Button key="mcp" label={`MCP ${ligadosMcp}/${cat.servidores.length} ${seta('mcp')}`} onPress={() => abrir('mcp')} />
          <Button key="skills" label={`Skills ${marcadas.length}/${cat.skills.length} ${seta('skills')}`} onPress={() => abrir('skills')} />
          <Button key="voz" label={`${c.voz ? '🔊' : '🔇'} Voz ${seta('voz')}`} onPress={() => abrir('voz')} />
          <Button key="ocultar" label="×" plain dimColor role="dismiss" onPress={() => update($, aba, () => 'oculto')} />
        </Box>

        {estado === 'contexto' &&
          secao(
            'Contexto enviado ao modelo',
            grade([
              { key: 'memoria', nome: 'Memória automática', marcado: c.memoria, onPress: alternarMemoria },
              { key: 'claudemd', nome: 'CLAUDE.md e regras', marcado: c.claudeMd, onPress: alternarClaudeMd },
            ]),
          )}

        {estado === 'mcp' &&
          secao(
            'Servidores MCP (desligado = schema fora do prompt e chamadas negadas)',
            cat.servidores.length === 0 ? (
              <Text dimColor>nenhum servidor conectado</Text>
            ) : (
              grade(
                cat.servidores.map(s => ({
                  key: `mcp:${s}`,
                  nome: s,
                  marcado: c.mcpLigados.includes(s),
                  onPress: () => alternarServidor(s),
                })),
              )
            ),
            cat.servidores.length > 0 && (
              <Box flexDirection="row" columnGap={2}>
                <Button key="mcp:todos" plain dimColor label="ligar todos" onPress={() => definirServidores([...cat.servidores])} />
                <Button key="mcp:nenhum" plain dimColor label="desligar todos" onPress={() => definirServidores([])} />
              </Box>
            ),
          )}

        {estado === 'skills' &&
          secao(
            'Skills marcadas entram no próximo pedido',
            <Box flexDirection="column">
              <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                {grupos.map(g => (
                  <Button
                    key={`grupo:${g}`}
                    plain
                    dimColor={g !== grupo}
                    label={`${g === grupo ? '▸' : ' '} ${g}`}
                    onPress={() => update($, grupoSkills, () => g)}
                  />
                ))}
              </Box>
              {cat.skills.length === 0 ? (
                <Text dimColor>nenhuma skill encontrada</Text>
              ) : (
                grade(
                  skillsDoGrupo.map(s => ({
                    key: `skill:${s.name}`,
                    nome: s.name,
                    marcado: marcadas.includes(s.name),
                    onPress: () => alternarSkill(s.name),
                  })),
                )
              )}
            </Box>,
            marcadas.length > 0 && (
              <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                <Text dimColor>Marcadas:</Text>
                <Text>{marcadas.join(', ')}</Text>
                <Button key="limpar" plain dimColor label="limpar" onPress={() => update($, skills, () => [])} />
              </Box>
            ),
          )}

        {estado === 'voz' &&
          secao(
            'Leitura em voz alta',
            <Box flexDirection="column">
              <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
                <Button key="voz:auto" plain dimColor={!c.voz} label={`${c.voz ? '●' : '○'} Ler cada resposta nova`} onPress={alternarAuto} />
                <Button key="voz:caixa" plain label="▶ Ler o que está na caixa" onPress={lerCaixa} />
                <Button key="voz:ultima" plain label="▶ Ler a última resposta" onPress={lerUltima} />
                <Button key="voz:parar" plain label="■ Parar" onPress={() => parar($)} />
              </Box>
              <Box flexDirection="row" columnGap={2}>
                <Text dimColor>Velocidade:</Text>
                {VELOCIDADES.map(v => (
                  <Button
                    key={`vel:${v}`}
                    plain
                    dimColor={v !== c.velocidade}
                    label={`${v === c.velocidade ? '●' : '○'} ${v.toFixed(1)}x`}
                    onPress={() => definirVelocidade(v)}
                  />
                ))}
              </Box>
            </Box>,
          )}
      </Box>
    )
  })
}
