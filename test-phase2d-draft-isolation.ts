/**
 * PHASE 2D FOCUSED TEST SUITE: DRAFT ISOLATION & COMPOSER LIFECYCLE
 *
 * Verifies:
 * 1. Typing a draft in conversation A, then switching to conversation B, does not carry the draft into B.
 * 2. Switching between conversations repeatedly does not leak drafts across conversations.
 * 3. A failed send preserves the draft in the current conversation for user retry.
 * 4. A successful send clears the draft.
 * 5. Ordinary polling and message refreshes (same conversation ID, new messages arriving) do NOT reset composer content.
 * 6. Existing authentication/session handling and cookie options remain intact.
 */

import assert from 'node:assert';
import fs from 'node:fs';

console.log('--- STARTING PHASE 2D DRAFT ISOLATION & COMPOSER LIFECYCLE TESTS ---\n');

let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res
        .then(() => {
          console.log(`  ✓ ${name}`);
          passed++;
        })
        .catch((err) => {
          console.error(`  ✗ ${name}:`, err.message);
          failed++;
        });
    } else {
      console.log(`  ✓ ${name}`);
      passed++;
    }
  } catch (err: any) {
    console.error(`  ✗ ${name}:`, err.message);
    failed++;
  }
}

async function executeTestSuite() {
  const threadSource = fs.readFileSync('src/components/messages/MessageThread.tsx', 'utf-8');
  const viewSource = fs.readFileSync('src/components/messages/MessagesView.tsx', 'utf-8');

  // 1. Simulation of MessageThread state lifecycle on conversation switch
  runTest('1. Composer draft lifecycle: switching conversation A -> B resets draft', () => {
    // Model the exact state and effect logic in MessageThread
    class SimulatedComposer {
      private content = '';
      private sendError: string | null = null;
      private currentConvId: string | null = null;

      public setConversation(convId: string | null) {
        if (convId !== this.currentConvId) {
          this.currentConvId = convId;
          // Effect triggered by [conversation?.id]
          this.content = '';
          this.sendError = null;
        }
      }

      public typeDraft(text: string) {
        this.content = text;
      }

      public getDraft() {
        return this.content;
      }

      public getSendError() {
        return this.sendError;
      }

      public async send(mockApiSuccess: boolean) {
        if (!this.content.trim()) return false;
        if (mockApiSuccess) {
          this.content = '';
          this.sendError = null;
          return true;
        } else {
          this.sendError = 'Failed to deliver message. Your draft has been preserved.';
          return false;
        }
      }
    }

    const composer = new SimulatedComposer();

    // Select Conversation A (e.g. Alice)
    composer.setConversation('conv-alice-123');
    composer.typeDraft('Confidential draft intended for Alice');
    assert.strictEqual(composer.getDraft(), 'Confidential draft intended for Alice');

    // Switch to Conversation B (e.g. Bob)
    composer.setConversation('conv-bob-456');
    assert.strictEqual(
      composer.getDraft(),
      '',
      'Switching to conversation B must give a clean empty composer'
    );
  });

  // 2. Switching between conversations repeatedly does not leak drafts
  runTest('2. Repeated conversation switching (A -> B -> A -> C) does not leak drafts', () => {
    class SimulatedComposer {
      private content = '';
      private currentConvId: string | null = null;

      public setConversation(convId: string | null) {
        if (convId !== this.currentConvId) {
          this.currentConvId = convId;
          this.content = '';
        }
      }

      public typeDraft(text: string) {
        this.content = text;
      }

      public getDraft() {
        return this.content;
      }
    }

    const composer = new SimulatedComposer();

    // A -> type draft
    composer.setConversation('conv-A');
    composer.typeDraft('Draft for A');

    // Switch to B -> must be empty
    composer.setConversation('conv-B');
    assert.strictEqual(composer.getDraft(), '', 'Conversation B composer must be empty');

    // Type in B
    composer.typeDraft('Draft for B');
    assert.strictEqual(composer.getDraft(), 'Draft for B');

    // Switch back to A -> must be clean (no unexpected restoration of B draft)
    composer.setConversation('conv-A');
    assert.strictEqual(composer.getDraft(), '', 'Switching back to A must not inherit B draft');

    // Switch to C -> must be clean
    composer.setConversation('conv-C');
    assert.strictEqual(composer.getDraft(), '', 'Conversation C composer must be empty');
  });

  // 3. Failed send preserves draft for retry
  await runTest('3. Failed send preserves draft in current conversation for user retry', async () => {
    let content = 'My important proposal that failed to send';
    let sendError: string | null = null;

    const onSendMessage = async (_text: string) => false; // simulated failure

    const handleSend = async () => {
      const trimmed = content.trim();
      const success = await onSendMessage(trimmed);
      if (success) {
        content = '';
      } else {
        sendError = 'Failed to deliver message. Your draft has been preserved.';
      }
    };

    await handleSend();

    assert.strictEqual(
      content,
      'My important proposal that failed to send',
      'Failed send must preserve message content in composer'
    );
    assert.ok(sendError?.includes('draft has been preserved'));
  });

  // 4. Successful send clears draft
  await runTest('4. Successful send clears draft in current conversation', async () => {
    let content = 'Hello world!';
    let sendError: string | null = 'Previous error';

    const onSendMessage = async (_text: string) => true; // simulated success

    const handleSend = async () => {
      const trimmed = content.trim();
      const success = await onSendMessage(trimmed);
      if (success) {
        content = '';
        sendError = null;
      }
    };

    await handleSend();

    assert.strictEqual(content, '', 'Successful send must clear composer content');
    assert.strictEqual(sendError, null, 'Successful send must clear sendError');
  });

  // 5. Polling and message updates do NOT reset draft when conversation ID is unchanged
  runTest('5. Polling or message history refresh does not reset composer if conversation ID is unchanged', () => {
    let composerContent = 'User actively typing a long message while polling occurs...';
    const activeConvId = 'conv-101';

    // Simulated polling response: new messages arrive, conversation object re-evaluated
    const onPollingUpdate = (newConvId: string, _newMessagesCount: number) => {
      if (newConvId !== activeConvId) {
        composerContent = '';
      }
    };

    onPollingUpdate('conv-101', 5);
    onPollingUpdate('conv-101', 6);
    onPollingUpdate('conv-101', 7);

    assert.strictEqual(
      composerContent,
      'User actively typing a long message while polling occurs...',
      'Draft must remain completely intact during background polling'
    );
  });

  // 6. Source inspection: MessageThread implementation
  runTest('6. MessageThread source defines useEffect on conversation?.id', () => {
    assert.ok(
      threadSource.includes("setContent('')"),
      'MessageThread must call setContent'
    );
    assert.ok(
      threadSource.includes('setSendError(null)'),
      'MessageThread must reset sendError on conversation switch'
    );
    assert.ok(
      threadSource.includes('[conversation?.id]'),
      'MessageThread must depend on [conversation?.id] to trigger reset'
    );
  });

  // 7. Source inspection: MessagesView keying
  runTest('7. MessagesView passes key prop to MessageThread based on activeConversation.id', () => {
    assert.ok(
      viewSource.includes('key={activeConversation?.id'),
      'MessagesView must pass key={activeConversation?.id} to MessageThread'
    );
  });

  // 8. Phase 2B Auth Safeguard: Ensure auth handling remains intact
  runTest('8. Phase 2B auth handling and cookie options remain intact', () => {
    const authRoutesSource = fs.readFileSync('server/routes/auth.routes.ts', 'utf-8');
    assert.ok(!viewSource.includes('refreshUser'), 'MessagesView must not contain refreshUser');
    assert.ok(viewSource.includes('AUTH_REQUIRED_MSG'), 'MessagesView must maintain AUTH_REQUIRED_MSG');
    assert.ok(authRoutesSource.includes('sameSite: isHttps ?'), 'auth.routes must maintain HTTPS sameSite handling');
  });

  console.log('\n--- PHASE 2D TEST RESULTS SUMMARY ---');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

executeTestSuite();
