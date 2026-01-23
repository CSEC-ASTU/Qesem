export interface AgentSuggestion {
    id: string
    label: string
    action: string
}

export interface AgentResponse {
    message: string
    suggestions?: AgentSuggestion[]
}

