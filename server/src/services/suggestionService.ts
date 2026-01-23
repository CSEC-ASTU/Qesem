export interface AgentSuggestion {
    id: string
    label: string
    action: string
}

export function generateExplainSuggestions(): AgentSuggestion[] {
    return [
        {
            id: 'quiz',
            label: 'Want a quick quiz?',
            action: 'START_QUIZ'
        },
        {
            id: 'visual',
            label: 'Explain with visuals',
            action: 'EXPLAIN_VISUAL'
        },
        {
            id: 'exam',
            label: 'Try an exam-style question',
            action: 'EXAM_QUESTION'
        }
    ]
}
