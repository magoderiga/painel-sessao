export type Config = {
  memoria: boolean
  claudeMd: boolean
  mcpLigados: string[]
  voz: boolean
  velocidade: number
  vozNome: string
}

export type SkillInfo = { name: string; description: string; grupo: string }

export type Catalogo = { servidores: string[]; skills: SkillInfo[] }

declare module 'claude-code' {
  interface PluginState {
    'painel-sessao': {
      config: Shaped<Config>
      skills: string[]
      oculto: boolean
      catalogo: Catalogo
      ultimaResposta: string
    }
  }
}
