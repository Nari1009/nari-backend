class AIProvider {
  async interpretConversation() {
    throw new Error('AIProvider.interpretConversation must be implemented by a provider.');
  }
}

module.exports = { AIProvider };
