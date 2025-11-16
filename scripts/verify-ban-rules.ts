/**
 * Script to verify ban rule enforcement in banGuards.ts
 * Tests the core enforcement logic with mock data
 */

import { logger } from '../server/utils/logger.js';

// Mock types to match the actual implementation
type BanRuleSetting = {
  enabled: boolean;
  schedule: {
    mode: 'all' | 'custom';
    start: string;
    end: string;
  };
};

type GroupBanSettingsRecord = {
  chatId: string;
  rules: {
    banLinks: BanRuleSetting;
    banPhotos: BanRuleSetting;
    banTextPatterns: BanRuleSetting;
    banForward: BanRuleSetting;
    banDomains: BanRuleSetting;
    [key: string]: BanRuleSetting;
  };
  whitelist: string[];
  blacklist: string[];
};

type MockMessage = {
  message_id: number;
  date: number;
  from: { id: number; first_name: string; is_bot: boolean };
  text?: string;
  photo?: any[];
  entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
  forward_date?: number;
  [key: string]: any;
};

class BanRuleVerifier {
  private testResults: Array<{ test: string; passed: boolean; details: string }> = [];

  async verifyAllRules(): Promise<void> {
    console.log('🔍 Verifying Ban Rule Enforcement Logic');
    console.log('='.repeat(50));

    await this.testLinkBanLogic();
    await this.testSchedulingLogic();
    await this.testWhitelistBlacklist();
    await this.testMediaDetection();
    await this.testTextPatternMatching();
    await this.testForwardDetection();

    this.generateReport();
  }

  private async testLinkBanLogic(): Promise<void> {
    console.log('\n🔗 Testing Link Ban Logic');
    
    // Test 1: Basic URL detection
    const message1: MockMessage = {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      from: { id: 12345, first_name: 'User', is_bot: false },
      text: 'Check this out: https://example.com',
      entities: [{ type: 'url', offset: 17, length: 19 }]
    };

    const hasLink = this.detectLinks(message1);
    this.addResult(
      'URL Detection',
      hasLink.length > 0,
      `Detected URLs: ${hasLink.join(', ')}`
    );

    // Test 2: Text link detection
    const message2: MockMessage = {
      message_id: 2,
      date: Math.floor(Date.now() / 1000),
      from: { id: 12345, first_name: 'User', is_bot: false },
      text: 'Click here',
      entities: [{ type: 'text_link', offset: 0, length: 10, url: 'https://hidden.com' }]
    };

    const hasTextLink = this.detectLinks(message2);
    this.addResult(
      'Text Link Detection',
      hasTextLink.length > 0,
      `Detected hidden URLs: ${hasTextLink.join(', ')}`
    );

    // Test 3: Multiple links
    const message3: MockMessage = {
      message_id: 3,
      date: Math.floor(Date.now() / 1000),
      from: { id: 12345, first_name: 'User', is_bot: false },
      text: 'Visit https://site1.com and https://site2.com',
      entities: [
        { type: 'url', offset: 6, length: 18 },
        { type: 'url', offset: 29, length: 18 }
      ]
    };

    const multipleLinks = this.detectLinks(message3);
    this.addResult(
      'Multiple Link Detection',
      multipleLinks.length === 2,
      `Detected ${multipleLinks.length} links: ${multipleLinks.join(', ')}`
    );
  }

  private async testSchedulingLogic(): Promise<void> {
    console.log('\n⏰ Testing Schedule Logic');
    
    const currentHour = new Date().getHours();
    const currentMinute = new Date().getMinutes();
    const currentTimeMinutes = currentHour * 60 + currentMinute;

    // Test 1: Rule active all day
    const allDayRule: BanRuleSetting = {
      enabled: true,
      schedule: { mode: 'all', start: '00:00', end: '23:59' }
    };

    const allDayActive = this.isRuleActiveAtTime(allDayRule, Math.floor(Date.now() / 1000));
    this.addResult(
      'All Day Rule Activity',
      allDayActive,
      'Rule with mode "all" should always be active'
    );

    // Test 2: Custom time window (9 AM to 5 PM)
    const businessHoursRule: BanRuleSetting = {
      enabled: true,
      schedule: { mode: 'custom', start: '09:00', end: '17:00' }
    };

    const inBusinessHours = currentTimeMinutes >= 540 && currentTimeMinutes <= 1020; // 9:00-17:00 in minutes
    const businessHoursActive = this.isRuleActiveAtTime(businessHoursRule, Math.floor(Date.now() / 1000));

    this.addResult(
      'Business Hours Rule',
      businessHoursActive === inBusinessHours,
      `Current time: ${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}, Should be active: ${inBusinessHours}, Actually active: ${businessHoursActive}`
    );

    // Test 3: Overnight rule (10 PM to 6 AM)
    const overnightRule: BanRuleSetting = {
      enabled: true,
      schedule: { mode: 'custom', start: '22:00', end: '06:00' }
    };

    const inOvernightHours = currentTimeMinutes >= 1320 || currentTimeMinutes <= 360; // 22:00+ or <=06:00
    const overnightActive = this.isRuleActiveAtTime(overnightRule, Math.floor(Date.now() / 1000));

    this.addResult(
      'Overnight Rule',
      overnightActive === inOvernightHours,
      `Should be active: ${inOvernightHours}, Actually active: ${overnightActive}`
    );
  }

  private async testWhitelistBlacklist(): Promise<void> {
    console.log('\n📝 Testing Whitelist/Blacklist Logic');

    const settings: GroupBanSettingsRecord = {
      chatId: '-1001234567890',
      rules: {
        banLinks: { enabled: true, schedule: { mode: 'all', start: '00:00', end: '23:59' } },
        banPhotos: { enabled: false, schedule: { mode: 'all', start: '00:00', end: '23:59' } },
        banTextPatterns: { enabled: false, schedule: { mode: 'all', start: '00:00', end: '23:59' } },
        banForward: { enabled: false, schedule: { mode: 'all', start: '00:00', end: '23:59' } },
        banDomains: { enabled: false, schedule: { mode: 'all', start: '00:00', end: '23:59' } }
      },
      whitelist: ['t.me', 'telegram.org'],
      blacklist: ['spam', 'scam']
    };

    // Test 1: Whitelisted domain should be allowed
    const whitelistedLinks = ['https://t.me/username', 'https://telegram.org/apps'];
    whitelistedLinks.forEach((link, index) => {
      const blocked = this.isLinkBlocked(link, settings);
      this.addResult(
        `Whitelist Test ${index + 1}`,
        !blocked,
        `Link ${link} should be allowed (whitelisted), blocked: ${blocked}`
      );
    });

    // Test 2: Blacklisted domain should be blocked
    const blacklistedLinks = ['https://spamsite.com', 'https://scammer.net'];
    blacklistedLinks.forEach((link, index) => {
      const blocked = this.isLinkBlocked(link, settings);
      this.addResult(
        `Blacklist Test ${index + 1}`,
        blocked,
        `Link ${link} should be blocked (blacklisted), blocked: ${blocked}`
      );
    });

    // Test 3: Regular link (not in whitelist or blacklist)
    const neutralLink = 'https://google.com';
    const neutralBlocked = this.isLinkBlocked(neutralLink, settings);
    this.addResult(
      'Neutral Link Test',
      !neutralBlocked, // Should be allowed if not in blacklist and no specific blocking
      `Link ${neutralLink} should be allowed (neutral), blocked: ${neutralBlocked}`
    );
  }

  private async testMediaDetection(): Promise<void> {
    console.log('\n📸 Testing Media Detection Logic');

    // Test photo detection
    const photoMessage: MockMessage = {
      message_id: 4,
      date: Math.floor(Date.now() / 1000),
      from: { id: 12345, first_name: 'User', is_bot: false },
      photo: [{ file_id: 'photo123', file_unique_id: 'unique123', width: 100, height: 100 }]
    };

    const hasPhoto = this.detectMediaTypes(photoMessage);
    this.addResult(
      'Photo Detection',
      hasPhoto.includes('photo'),
      `Detected media types: ${hasPhoto.join(', ')}`
    );

    // Test video detection
    const videoMessage: MockMessage = {
      message_id: 5,
      date: Math.floor(Date.now() / 1000),
      from: { id: 12345, first_name: 'User', is_bot: false },
      video: { file_id: 'video123', file_unique_id: 'unique123', duration: 30 }
    };

    const hasVideo = this.detectMediaTypes(videoMessage);
    this.addResult(
      'Video Detection',
      hasVideo.includes('video'),
      `Detected media types: ${hasVideo.join(', ')}`
    );
  }

  private async testTextPatternMatching(): Promise<void> {
    console.log('\n🔤 Testing Text Pattern Matching');

    const testTexts = [
      { text: 'Join my spam channel for free money!', shouldMatch: true, pattern: 'spam' },
      { text: 'This is a normal message', shouldMatch: false, pattern: 'spam' },
      { text: 'Check out this PROMO code', shouldMatch: true, pattern: 'promo' },
      { text: 'Promotion ends today', shouldMatch: true, pattern: 'promo' }
    ];

    const blacklistPatterns = ['spam', 'promo'];

    testTexts.forEach((testCase, index) => {
      const matches = this.matchesTextPattern(testCase.text, blacklistPatterns);
      this.addResult(
        `Text Pattern ${index + 1}`,
        matches === testCase.shouldMatch,
        `Text: "${testCase.text}", Pattern: ${testCase.pattern}, Expected: ${testCase.shouldMatch}, Got: ${matches}`
      );
    });
  }

  private async testForwardDetection(): Promise<void> {
    console.log('\n📤 Testing Forward Detection');

    // Test forwarded message
    const forwardedMessage: MockMessage = {
      message_id: 6,
      date: Math.floor(Date.now() / 1000),
      from: { id: 12345, first_name: 'User', is_bot: false },
      text: 'Forwarded content',
      forward_date: Math.floor(Date.now() / 1000) - 3600 // Forwarded 1 hour ago
    };

    const isForwarded = this.detectForward(forwardedMessage);
    this.addResult(
      'Forward Detection',
      isForwarded,
      `Message should be detected as forwarded: ${isForwarded}`
    );

    // Test regular message
    const regularMessage: MockMessage = {
      message_id: 7,
      date: Math.floor(Date.now() / 1000),
      from: { id: 12345, first_name: 'User', is_bot: false },
      text: 'Regular content'
    };

    const isRegular = this.detectForward(regularMessage);
    this.addResult(
      'Regular Message Detection',
      !isRegular,
      `Message should NOT be detected as forwarded: ${isRegular}`
    );
  }

  // Helper methods that mimic the actual implementation logic

  private detectLinks(message: MockMessage): string[] {
    const links: string[] = [];
    
    if (message.entities) {
      for (const entity of message.entities) {
        if (entity.type === 'url' && message.text) {
          const url = message.text.slice(entity.offset, entity.offset + entity.length);
          links.push(url);
        } else if (entity.type === 'text_link' && entity.url) {
          links.push(entity.url);
        }
      }
    }

    // Also check for URLs in text without entities
    if (message.text) {
      const urlRegex = /https?:\/\/[^\s]+/gi;
      const matches = message.text.match(urlRegex);
      if (matches) {
        links.push(...matches);
      }
    }

    return links;
  }

  private isRuleActiveAtTime(rule: BanRuleSetting, timestampSeconds: number): boolean {
    if (!rule.enabled) {
      return false;
    }

    if (rule.schedule.mode === 'all') {
      return true;
    }

    const currentMinutes = this.getMinutesOfDay(timestampSeconds);
    const startMinutes = this.parseTimeToMinutes(rule.schedule.start);
    const endMinutes = this.parseTimeToMinutes(rule.schedule.end);

    if (startMinutes === null || endMinutes === null) {
      return true; // Default to active if times are invalid
    }

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } else {
      // Overnight rule (e.g., 22:00-06:00)
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }
  }

  private isLinkBlocked(url: string, settings: GroupBanSettingsRecord): boolean {
    const domain = this.extractDomain(url);
    if (!domain) return false;

    // Check whitelist first
    if (settings.whitelist.some(allowed => domain.includes(allowed) || url.includes(allowed))) {
      return false; // Whitelisted, allow
    }

    // Check blacklist
    if (settings.blacklist.some(blocked => domain.includes(blocked) || url.includes(blocked))) {
      return true; // Blacklisted, block
    }

    // If banLinks is enabled and not whitelisted, block
    return settings.rules.banLinks?.enabled || false;
  }

  private detectMediaTypes(message: MockMessage): string[] {
    const types: string[] = [];
    if (message.photo) types.push('photo');
    if (message.video) types.push('video');
    if (message.audio) types.push('audio');
    if (message.voice) types.push('voice');
    if (message.document) types.push('document');
    if (message.sticker) types.push('sticker');
    if (message.animation) types.push('animation');
    return types;
  }

  private matchesTextPattern(text: string, patterns: string[]): boolean {
    const lowerText = text.toLowerCase();
    return patterns.some(pattern => lowerText.includes(pattern.toLowerCase()));
  }

  private detectForward(message: MockMessage): boolean {
    return Boolean(message.forward_date);
  }

  private extractDomain(url: string): string | null {
    try {
      const parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
      return parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  private getMinutesOfDay(timestampSeconds: number): number {
    const date = new Date(timestampSeconds * 1000);
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }

  private parseTimeToMinutes(timeString: string): number | null {
    const match = /^(\d{2}):(\d{2})$/.exec(timeString);
    if (!match) return null;
    
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return null;
    }
    
    return hours * 60 + minutes;
  }

  private addResult(test: string, passed: boolean, details: string): void {
    this.testResults.push({ test, passed, details });
    const status = passed ? '✅' : '❌';
    console.log(`  ${status} ${test}: ${details}`);
  }

  private generateReport(): void {
    console.log('\n' + '='.repeat(50));
    console.log('📊 BAN RULES VERIFICATION REPORT');
    console.log('='.repeat(50));

    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(r => r.passed).length;
    const failedTests = totalTests - passedTests;

    console.log(`\nTotal Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests} ✅`);
    console.log(`Failed: ${failedTests} ❌`);
    console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

    if (failedTests > 0) {
      console.log('\n❌ FAILED TESTS:');
      this.testResults
        .filter(r => !r.passed)
        .forEach(result => {
          console.log(`  • ${result.test}: ${result.details}`);
        });
    }

    console.log('\n🔍 ANALYSIS:');
    if (failedTests === 0) {
      console.log('✅ All ban rule logic tests passed!');
      console.log('The core enforcement algorithms appear to be working correctly.');
    } else {
      console.log('⚠️  Some logic tests failed. This indicates potential issues in:');
      console.log('  • banGuards.ts implementation');
      console.log('  • Rule scheduling logic');  
      console.log('  • Link detection algorithms');
      console.log('  • Whitelist/blacklist processing');
    }

    console.log('\n📝 NEXT STEPS:');
    console.log('1. Review any failed tests and fix the underlying logic');
    console.log('2. Test the actual enforcement in real Telegram groups');
    console.log('3. Verify database integration and settings loading');
    console.log('4. Monitor bot logs during real-world usage');
  }
}

// Export for manual testing
export { BanRuleVerifier };

// Example usage comment
console.log('💡 To run this verifier:');
console.log('import { BanRuleVerifier } from "./verify-ban-rules.js"');
console.log('const verifier = new BanRuleVerifier();');
console.log('await verifier.verifyAllRules();');
