import {
  AdditionNode,
  DeletionNode,
  MentionNode,
  MentionNode2,
  ReplacementNode,
  UnchangedNode,
} from '@/lib/nodes'

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
