export type Config = {
  memoria: boolean
  claudeMd: boolean
  mcpLigados: string[]
  voz: boolean
  velocidade: number
}

export type SkillInfo = { name: string; description: string; grupo: string }

export type Catalogo = { servidores: string[]; skills: SkillInfo[] }

export type Aba = 'fechado' | 'contexto' | 'mcp' | 'skills' | 'voz' | 'oculto'

declare module 'claude-code' {
  interface PluginState {
    'painel-sessao': {
      config: Shaped<Config>
      skills: string[]
      aba: Aba
      grupoSkills: string
      catalogo: Catalogo
      ultimaResposta: string
    }
  }
}
