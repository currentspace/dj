import type {Page} from '@playwright/test'
import {expect} from '@playwright/test'

import {BasePage} from './BasePage'

/**
 * Page object for chat-related interactions
 */
export class ChatPage extends BasePage {
  // Selectors
  readonly chatInterface = '.chat-interface'
  readonly chatHeader = '.chat-header'
  readonly chatMessages = '.chat-messages'
  readonly chatInputForm = '.chat-input-form'
  readonly chatInput = '.chat-input-form input[type="text"]'
  readonly sendButton = '.chat-input-form button[type="submit"]'
  readonly welcomeMessage = '.welcome-message'
  readonly modeSelector = '.mode-selector select'
  readonly selectedPlaylistInfo = '.selected-playlist-info'
  readonly streamingStatus = '.streaming-status'
  readonly streamingPulse = '.streaming-pulse'
  readonly statusAction = '.status-action'
  readonly statusTool = '.status-tool'
  readonly statusToolsUsed = '.status-tools-used'

  // Message selectors
  readonly message = '.message'
  readonly userMessage = '.message.user'
  readonly assistantMessage = '.message.assistant'
  readonly messageContent = '.message-content'

  constructor(page: Page) {
    super(page)
  }

  /**
   * Check if chat interface is visible
   */
  async isChatVisible() {
    return this.isVisible(this.chatInterface)
  }

  /**
   * Check if welcome message is shown
   */
  async hasWelcomeMessage() {
    return this.isVisible(this.welcomeMessage)
  }

  /**
   * Get the current mode
   */
  async getCurrentMode(): Promise<string> {
    return this.page.locator(this.modeSelector).inputValue()
  }

  /**
   * Set the chat mode
   */
  async setMode(mode: 'analyze' | 'create' | 'dj' | 'edit') {
    await this.page.locator(this.modeSelector).selectOption(mode)
  }

  /**
   * Type a message in the input
   */
  async typeMessage(message: string) {
    await this.page.fill(this.chatInput, message)
  }

  /**
   * Send a message (type and click send)
   */
  async sendMessage(message: string) {
    await this.typeMessage(message)
    await this.page.click(this.sendButton)
  }

  /**
   * Check if input is enabled
   */
  async isInputEnabled(): Promise<boolean> {
    return this.page.locator(this.chatInput).isEnabled()
  }

  /**
   * Check if send button is enabled
   */
  async isSendEnabled(): Promise<boolean> {
    return this.page.locator(this.sendButton).isEnabled()
  }

  /**
   * Check if currently streaming
   */
  async isStreaming(): Promise<boolean> {
    return this.isVisible(this.streamingPulse)
  }

  /**
   * Wait for streaming to complete
   */
  async waitForStreamingComplete(timeout: number = 30000) {
    // Wait for streaming pulse to disappear
    await this.page.waitForSelector(this.streamingPulse, {
      state: 'hidden',
      timeout,
    })
  }

  /**
   * Get the current streaming status text
   */
  async getStreamingStatus(): Promise<string | null> {
    const visible = await this.isVisible(this.statusAction)
    if (!visible) return null
    return this.page.textContent(this.statusAction)
  }

  /**
   * Get the current tool being used
   */
  async getCurrentTool(): Promise<string | null> {
    const visible = await this.isVisible(this.statusTool)
    if (!visible) return null
    return this.page.textContent(this.statusTool)
  }

  /**
   * Get list of tools used
   */
  async getToolsUsed(): Promise<string | null> {
    const visible = await this.isVisible(this.statusToolsUsed)
    if (!visible) return null
    return this.page.textContent(this.statusToolsUsed)
  }

  /**
   * Get message count
   */
  async getMessageCount(): Promise<number> {
    return this.page.locator(this.message).count()
  }

  /**
   * Get user message count
   */
  async getUserMessageCount(): Promise<number> {
    return this.page.locator(this.userMessage).count()
  }

  /**
   * Get assistant message count
   */
  async getAssistantMessageCount(): Promise<number> {
    return this.page.locator(this.assistantMessage).count()
  }

  /**
   * Get all message texts
   */
  async getMessages(): Promise<{content: string; role: 'assistant' | 'user'}[]> {
    const messages: {content: string; role: 'assistant' | 'user'}[] = []
    const locators = this.page.locator(this.message)
    const count = await locators.count()

    for (let i = 0; i < count; i++) {
      const el = locators.nth(i)
      const classList = await el.getAttribute('class')
      const role = classList?.includes('user') ? 'user' : 'assistant'
      const content = (await el.locator(this.messageContent).textContent()) || ''
      messages.push({content, role})
    }

    return messages
  }

  /**
   * Get last message
   */
  async getLastMessage(): Promise<{content: string; role: 'assistant' | 'user'} | null> {
    const messages = await this.getMessages()
    return messages.length > 0 ? messages[messages.length - 1] : null
  }

  /**
   * Get last assistant message text
   */
  async getLastAssistantMessage(): Promise<string | null> {
    const locators = this.page.locator(this.assistantMessage)
    const count = await locators.count()
    if (count === 0) return null
    const lastMsg = locators.nth(count - 1)
    return lastMsg.locator(this.messageContent).textContent()
  }

  /**
   * Wait for a new assistant message
   */
  async waitForAssistantMessage(timeout: number = 30000) {
    const currentCount = await this.getAssistantMessageCount()
    await this.page.waitForFunction(
      ({selector, count}) => document.querySelectorAll(selector).length > count,
      {selector: this.assistantMessage, count: currentCount},
      {timeout},
    )
  }

  /**
   * Assert chat interface is visible
   */
  async assertChatVisible() {
    await expect(this.page.locator(this.chatInterface)).toBeVisible()
  }

  /**
   * Assert welcome message is shown
   */
  async assertWelcomeMessage() {
    await expect(this.page.locator(this.welcomeMessage)).toBeVisible()
  }

  /**
   * Assert streaming is active
   */
  async assertStreaming() {
    await expect(this.page.locator(this.streamingPulse)).toBeVisible()
  }

  /**
   * Assert input is disabled during streaming
   */
  async assertInputDisabled() {
    await expect(this.page.locator(this.chatInput)).toBeDisabled()
  }

  /**
   * Assert message count
   */
  async assertMessageCount(expected: number) {
    await expect(this.page.locator(this.message)).toHaveCount(expected)
  }

  /**
   * Assert assistant message contains text
   */
  async assertAssistantMessageContains(text: string) {
    await expect(
      this.page.locator(this.assistantMessage).last().locator(this.messageContent),
    ).toContainText(text)
  }

  /**
   * Assert error message in chat
   */
  async assertErrorInChat(expectedText?: string) {
    const lastMsg = await this.getLastAssistantMessage()
    expect(lastMsg).toContain('Error')
    if (expectedText) {
      expect(lastMsg).toContain(expectedText)
    }
  }
}
