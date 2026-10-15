import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  readFileSync,
} from 'node:fs'

function source(path) {
  assert.ok(
    existsSync(path),
    `${path} must exist`,
  )

  return readFileSync(
    path,
    'utf8',
  )
}

const task5Files = [
  'src/chat/ChatShell.tsx',
  'src/chat/hooks/useConversations.ts',
  'src/chat/hooks/useMessages.ts',
  'src/chat/conversations/ConversationSidebar.tsx',
  'src/chat/conversations/DirectMessageList.tsx',
  'src/chat/conversations/RoomList.tsx',
  'src/chat/messages/MessageTimeline.tsx',
  'src/chat/messages/MessageComposer.tsx',
]

test(
  'ChatModule delegates the communications surface to ChatShell',
  () => {
    const moduleSource = source(
      'src/modules/ChatModule.tsx',
    )

    assert.match(
      moduleSource,
      /from\s+['"]\.\.\/chat\/ChatShell['"]/,
      'ChatModule must import ChatShell',
    )

    assert.match(
      moduleSource,
      /<ChatShell\b/,
      'ChatModule must render ChatShell',
    )
  },
)

test(
  'the conversation sidebar separates Rooms and Direct Messages',
  () => {
    const sidebar = source(
      'src/chat/conversations/ConversationSidebar.tsx',
    )

    source(
      'src/chat/conversations/RoomList.tsx',
    )

    source(
      'src/chat/conversations/DirectMessageList.tsx',
    )

    assert.match(
      sidebar,
      /RoomList/,
      'ConversationSidebar must render RoomList',
    )

    assert.match(
      sidebar,
      /DirectMessageList/,
      'ConversationSidebar must render DirectMessageList',
    )

    assert.match(
      sidebar,
      />\s*Rooms\s*</,
      'sidebar must expose a Rooms section',
    )

    assert.match(
      sidebar,
      />\s*Direct Messages\s*</,
      'sidebar must expose a Direct Messages section',
    )
  },
)

test(
  'MessageComposer exposes explicit sending sent failed and retry states',
  () => {
    const composer = source(
      'src/chat/messages/MessageComposer.tsx',
    )

    for (const state of [
      'sending',
      'sent',
      'failed',
    ]) {
      assert.match(
        composer,
        new RegExp(`['"]${state}['"]`),
        `composer must expose ${state} state`,
      )
    }

    assert.match(
      composer,
      /\bonRetry\b/,
      'failed messages must expose a retry action',
    )

    assert.match(
      composer,
      /\bRetry\b/,
      'composer must render retry affordance',
    )
  },
)

test(
  'the extracted Chat shell keeps existing DM call voice and attachment capabilities reachable',
  () => {
    const combined = task5Files
      .map(path => source(path))
      .join('\n')

    for (const capability of [
      'useChatCalls',
      'roomApi',
      'voiceNote',
      'chatAttachments',
    ]) {
      assert.match(
        combined,
        new RegExp(capability),
        `Task 5 shell must preserve ${capability}`,
      )
    }
  },
)

test(
  'ChatShell exports itself and never retains the legacy ChatModule export',
  () => {
    const shell = source(
      'src/chat/ChatShell.tsx',
    )

    assert.match(
      shell,
      /export function ChatShell\s*\(/,
      'ChatShell must expose the extracted component',
    )

    assert.doesNotMatch(
      shell,
      /export default ChatModule/,
      'ChatShell must not retain the copied ChatModule default export',
    )

    assert.match(
      shell,
      /export default ChatShell/,
      'ChatShell should default-export itself',
    )
  },
)

test(
  'ChatShell actually composes the extracted sidebar timeline and composer',
  () => {
    const shell = source(
      'src/chat/ChatShell.tsx',
    )

    for (const component of [
      'ConversationSidebar',
      'MessageTimeline',
      'MessageComposer',
    ]) {
      assert.match(
        shell,
        new RegExp(
          `import[\\s\\S]*\\b${component}\\b`,
        ),
        `ChatShell must import ${component}`,
      )

      assert.match(
        shell,
        new RegExp(`<${component}\\b`),
        `ChatShell must render ${component}`,
      )
    }
  },
)

test(
  'ConversationSidebar preserves the existing direct-message layout hook',
  () => {
    const sidebar = source(
      'src/chat/conversations/ConversationSidebar.tsx',
    )

    assert.match(
      sidebar,
      /className="cmSide"/,
      'the extracted sidebar must preserve the legacy cmSide CSS hook',
    )
  },
)

test(
  'plain direct messages route through the Task 4 chat API',
  () => {
    const shell = source(
      'src/chat/ChatShell.tsx',
    )

    assert.match(
      shell,
      /from\s*['"]\.\/api\/chatApi['"]/,
      'ChatShell must import the secured Chat API module',
    )

    assert.match(
      shell,
      /\bsendMessage\s+as\s+sendChatMessage\b/,
      'ChatShell must use the secured Task 4 sender',
    )

    assert.match(
      shell,
      /if\s*\(\s*!file\s*\)\s*\{[\s\S]{0,2200}await\s+sendChatMessage\s*\(\s*\{[\s\S]{0,1200}conversationId[\s\S]{0,1200}clientMessageId/,
      'plain messages must use sendChatMessage with an idempotency key',
    )
  },
)

test(
  'failed direct-message retries reuse the original client message id',
  () => {
    const shell = source(
      'src/chat/ChatShell.tsx',
    )

    assert.match(
      shell,
      /client_message_id\??\s*:\s*string\s*\|\s*null/,
      'optimistic messages must retain their client message id',
    )

    assert.match(
      shell,
      /client_message_id\s*:\s*clientMessageId/,
      'the optimistic message must store the generated client id',
    )

    assert.match(
      shell,
      /clientMessageId\s*:\s*message\.client_message_id\s*\|\|\s*undefined/,
      'retry must reuse the original client message id',
    )
  },
)
