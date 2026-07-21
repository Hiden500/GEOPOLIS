/**
 * Agent LRU Cache Manager
 * Автоматически загружает часто используемые агентов, откладывает редкие
 * 
 * Использование:
 *   const cache = new AgentLRUCache(10);
 *   const agent = cache.get('bug-hunter');
 *   cache.getStats();
 */

class AgentLRUCache {
  constructor(maxSize = 10) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.hits = new Map();
    this.loadTimes = new Map();
    this.promotionThreshold = 3; // Количество обращений для promote
    this.session = {
      startTime: Date.now(),
      queries: 0,
      promoted: [],
      demoted: []
    };
  }

  /**
   * Получить агента из кэша
   * @param {string} agentName - Имя агента
   * @returns {object|null} - Содержимое агента или null
   */
  get(agentName) {
    if (!this.cache.has(agentName)) {
      return null;
    }

    const hit = (this.hits.get(agentName) || 0) + 1;
    this.hits.set(agentName, hit);
    this.session.queries++;

    // Проверяем, нужно ли promote агента
    if (hit === this.promotionThreshold) {
      this.session.promoted.push(agentName);
      console.log(`✅ Agent '${agentName}' promoted to hot (${hit} hits)`);
    }

    return {
      content: this.cache.get(agentName),
      hits: hit,
      cachedAt: this.loadTimes.get(agentName)
    };
  }

  /**
   * Добавить агента в кэш
   * @param {string} agentName - Имя агента
   * @param {any} agentCode - Код/содержимое агента
   * @param {boolean} isHot - Часто ли используется
   */
  set(agentName, agentCode, isHot = false) {
    // Если кэш переполнен, удаляем самый редко используемый
    if (this.cache.size >= this.maxSize && !this.cache.has(agentName)) {
      const lruAgent = this._findLRU();
      if (lruAgent) {
        this.cache.delete(lruAgent);
        this.hits.delete(lruAgent);
        this.loadTimes.delete(lruAgent);
        this.session.demoted.push(lruAgent);
        console.log(`🗑️  Agent '${lruAgent}' evicted from cache (${this.hits.get(lruAgent) || 0} hits)`);
      }
    }

    this.cache.set(agentName, agentCode);
    this.loadTimes.set(agentName, Date.now());
    
    if (!this.hits.has(agentName)) {
      this.hits.set(agentName, 0);
    }

    const status = isHot ? '🔥 HOT' : '❄️  COLD';
    console.log(`📦 Cached agent '${agentName}' (${status})`);
  }

  /**
   * Найти наименее используемый агент
   * @private
   */
  _findLRU() {
    if (this.cache.size === 0) return null;

    let lruAgent = null;
    let minHits = Infinity;

    for (const agent of this.cache.keys()) {
      const hits = this.hits.get(agent) || 0;
      if (hits < minHits) {
        minHits = hits;
        lruAgent = agent;
      }
    }

    return lruAgent;
  }

  /**
   * Получить статистику кэша
   */
  getStats() {
    const elapsed = (Date.now() - this.session.startTime) / 1000;
    const hitRate = this.session.queries > 0 
      ? ((this.cache.size / this.session.queries) * 100).toFixed(2)
      : 0;

    return {
      cacheSize: this.cache.size,
      maxSize: this.maxSize,
      totalQueries: this.session.queries,
      hitRate: `${hitRate}%`,
      elapsed: `${elapsed.toFixed(2)}s`,
      cachedAgents: Array.from(this.cache.keys()),
      hitCounts: Object.fromEntries(this.hits),
      promoted: this.session.promoted,
      demoted: this.session.demoted,
      recommendations: this._getRecommendations()
    };
  }

  /**
   * Рекомендации по оптимизации
   * @private
   */
  _getRecommendations() {
    const recs = [];
    const sorted = Array.from(this.hits.entries())
      .sort((a, b) => b[1] - a[1]);

    // Агенты для promote
    const hotCandidates = sorted
      .filter(([_, hits]) => hits >= this.promotionThreshold)
      .slice(0, 5);

    if (hotCandidates.length > 0) {
      recs.push({
        type: 'promote',
        agents: hotCandidates.map(([name]) => name),
        reason: 'High usage rate (3+ hits)'
      });
    }

    // Агенты для demote
    const coldCandidates = sorted
      .filter(([_, hits]) => hits === 0)
      .slice(0, 3);

    if (coldCandidates.length > 0) {
      recs.push({
        type: 'demote',
        agents: coldCandidates.map(([name]) => name),
        reason: 'Never used in this session'
      });
    }

    return recs;
  }

  /**
   * Сбросить кэш
   */
  clear() {
    this.cache.clear();
    this.hits.clear();
    this.loadTimes.clear();
    this.session = {
      startTime: Date.now(),
      queries: 0,
      promoted: [],
      demoted: []
    };
    console.log('🔄 Cache cleared');
  }

  /**
   * Экспортировать конфиг для CLAUDE.md
   */
  exportConfig() {
    const hotAgents = Array.from(this.hits.entries())
      .filter(([_, hits]) => hits >= this.promotionThreshold)
      .map(([name]) => name);

    const coldAgents = Array.from(this.cache.keys())
      .filter(name => !hotAgents.includes(name));

    return {
      version: '1.0',
      timestamp: new Date().toISOString(),
      enabled: hotAgents,
      deferred: coldAgents,
      settings: {
        maxSize: this.maxSize,
        promotionThreshold: this.promotionThreshold
      }
    };
  }

  /**
   * Импортировать конфиг из предыдущей сессии
   */
  importConfig(config) {
    console.log(`📥 Importing config from ${config.timestamp}`);
    this.promotionThreshold = config.settings.promotionThreshold;
    
    config.enabled.forEach(agent => {
      this.hits.set(agent, this.promotionThreshold);
    });
    
    return config;
  }
}

// Экспорт для использования в Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AgentLRUCache;
}

// Пример использования
if (require.main === module) {
  const cache = new AgentLRUCache(5);

  // Симуляция использования агентов
  console.log('\n🧪 Simulating agent usage...\n');

  const agents = {
    'bug-hunter': 'Find bugs in code',
    'code-reviewer': 'Review code quality',
    'security-scanner': 'Scan for vulnerabilities',
    'database-architect': 'Design database schemas',
    'deployment-engineer': 'Handle deployment'
  };

  // Загружаем агентов
  Object.entries(agents).forEach(([name, code]) => {
    cache.set(name, code);
  });

  // Использование (bug-hunter много раз, deployment-engineer один раз)
  cache.get('bug-hunter');
  cache.get('bug-hunter');
  cache.get('bug-hunter');
  cache.get('code-reviewer');
  cache.get('code-reviewer');
  cache.get('security-scanner');
  cache.get('deployment-engineer');

  console.log('\n📊 Cache Statistics:\n');
  console.log(JSON.stringify(cache.getStats(), null, 2));

  console.log('\n⚙️  Exported Config:\n');
  console.log(JSON.stringify(cache.exportConfig(), null, 2));
}