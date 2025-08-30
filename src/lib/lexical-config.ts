import {
  AdditionNode,
  DeletionNode,
  MentionNode,
  MentionNode2,
  ReplacementNode,
  UnchangedNode,
} from '@/lib/nodes'

/**
 * Lexical editor configuration for tweet editors
 * Contains theme, error handling, and custom nodes for mentions and diffs
 */
export const initialConfig = {
  namespace: `tweet-editor`,
  theme: {
    text: {
      bold: 'font-bold',
      italic: 'italic',
      underline: 'underline',
    },
  },
  onError: (error: Error) => {
    console.error('[Tweet Editor Error]', error)
  },
  nodes: [
    DeletionNode,
    AdditionNode,
    UnchangedNode,
    ReplacementNode,
    MentionNode,
    MentionNode2,
  ],
}
