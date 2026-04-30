// import { api } from './api'
// import { useStore } from './store'
// import type { Monaco } from '@monaco-editor/react'

// let isRegistered = false

// export function registerAIAutocomplete(monaco: Monaco) {
//   if (isRegistered) return
//   isRegistered = true

//   monaco.languages.registerInlineCompletionsProvider('python', {
//     provideInlineCompletions: async (model: any, position: any, context: any, token: any) => {
//       // Basic debounce/throttling strategy: only autocomplete if cursor is at the end of a line or whitespace
//       // But let's just do it on trigger
//       const fullText = model.getValue()
//       const offset = model.getOffsetAt(position)
      
//       const prefix = fullText.slice(0, offset)
//       const suffix = fullText.slice(offset)
      
//       // We can also pull in previous cells for better context
//       const notebook = useStore.getState().currentNotebook
//       let contextPrefix = ''
//       if (notebook) {
//         // Find the current cell (model.uri tells us? Monaco creates unique URIs for models)
//         // A simpler way: just get all code cells before the one that exactly matches fullText
//         // But since multiple cells might have the same text, it's not perfect. It's okay.
//         let found = false
//         for (const cell of notebook.cells) {
//           if (cell.type === 'code') {
//             if (cell.source === fullText) {
//               found = true
//               break
//             }
//             contextPrefix += cell.source + '\n\n'
//           }
//         }
//         if (!found) contextPrefix = '' // fallback if matching fails
//       }

//       const prompt = `You are an expert AI autocomplete engine for a Jupyter notebook.
// Provide the code completion that follows the exact cursor location.
// Do not include any explanation or markdown formatting. Just output the raw code.

// # Previous cells context:
// ${contextPrefix}

// # Current cell:
// Code before cursor:
// ${prefix}
// Code after cursor:
// ${suffix}

// Output only the exact string to insert at the cursor. If the code is already complete, output nothing.`

//       try {
//         const res = await api.ai.completions([
//           { role: 'system', content: 'You are an AI code autocomplete assistant. Output only the raw code to insert. No markdown, no explanation.' },
//           { role: 'user', content: prompt }
//         ])
        
//         if (token.isCancellationRequested) return { items: [] }
        
//         let completion = res.choices?.[0]?.message?.content || ''
        
//         // Cleanup potential markdown formatting
//         completion = completion.trim()
//         if (completion.startsWith('```python')) {
//           completion = completion.replace(/^```python\n?/, '')
//         } else if (completion.startsWith('```')) {
//           completion = completion.replace(/^```\n?/, '')
//         }
//         if (completion.endsWith('```')) {
//           completion = completion.replace(/\n?```$/, '')
//         }

//         if (!completion) return { items: [] }

//         return {
//           items: [{
//             insertText: completion,
//             range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column)
//           }]
//         }
//       } catch (err) {
//         console.error('AI Autocomplete error:', err)
//         return { items: [] }
//       }
//     },
//     freeInlineCompletions(completions: any) {
//       // Required by the API but we don't need to do anything
//     }
//   })
// }
