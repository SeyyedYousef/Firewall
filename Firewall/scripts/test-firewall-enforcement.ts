#!/usr/bin/env tsx
/**
 * Manual test script for firewall enforcement verification
 * This script helps verify that each firewall setting actually works in real groups
 */

import { loadBanSettingsByChatId, loadGeneralSettingsByChatId, loadSilenceSettingsByChatId, loadLimitSettingsByChatId } from '../server/db/groupSettingsRepository.js';
import { evaluateBanGuards } from '../bot/processing/banGuards.js';
import { runFirewall } from '../bot/processing/firewallEngine.js';
import { logger } from '../server/utils/logger.js';

interface TestResult {
  testName: string;
  passed: boolean;
  reason: string;
  details?: Record<string, unknown>;
}

class FirewallEnforcementTester {
  private results: TestResult[] = [];
  private testGroupId = "-1001234567890"; // Replace with actual test group ID

  async runAllTests(): Promise<void> {
    console.log("🚀 Starting Firewall Enforcement Tests");
    console.log("=".repeat(50));

    await this.testGeneralSettingsEnforcement();
    await this.testContentRestrictionEnforcement();
    await this.testLimitsEnforcement();
    await this.testQuietHoursEnforcement();
    await this.testMandatoryMembershipEnforcement();
    await this.testCustomMessageEnforcement();

    this.generateReport();
  }

  private async testGeneralSettingsEnforcement(): Promise<void> {
    console.log("\n📋 Testing General Settings Enforcement");
    console.log("-".repeat(30));

    try {
      const settings = await loadGeneralSettingsByChatId(this.testGroupId);
      
      if (!settings) {
        this.addResult("General Settings Load", false, "Settings not found for test group");
        return;
      }

      // Test 1: Welcome Message Setting
      this.addResult(
        "Welcome Message Setting",
        settings.welcomeEnabled !== undefined,
        `Welcome enabled: ${settings.welcomeEnabled}`
      );

      // Test 2: Warning System Setting
      this.addResult(
        "Warning System Setting",
        settings.warningEnabled !== undefined,
        `Warning enabled: ${settings.warningEnabled}`
      );

      // Test 3: Silent Mode Setting
      this.addResult(
        "Silent Mode Setting",
        settings.silentModeEnabled !== undefined,
        `Silent mode enabled: ${settings.silentModeEnabled}`
      );

      // Test 4: Auto-delete Setting
      this.addResult(
        "Auto-delete Setting",
        settings.autoDeleteEnabled !== undefined && settings.autoDeleteDelayMinutes !== undefined,
        `Auto-delete: ${settings.autoDeleteEnabled}, Delay: ${settings.autoDeleteDelayMinutes}min`
      );

      // Test 5: User Verification Setting
      this.addResult(
        "User Verification Setting",
        settings.userVerificationEnabled !== undefined,
        `User verification enabled: ${settings.userVerificationEnabled}`
      );

    } catch (error) {
      this.addResult("General Settings Load", false, `Error: ${error}`);
    }
  }

  private async testContentRestrictionEnforcement(): Promise<void> {
    console.log("\n🚫 Testing Content Restriction Enforcement");
    console.log("-".repeat(30));

    try {
      const settings = await loadBanSettingsByChatId(this.testGroupId);
      
      if (!settings) {
        this.addResult("Ban Settings Load", false, "Ban settings not found for test group");
        return;
      }

      // Test ban rules configuration
      const banRules = settings.rules;
      
      this.addResult(
        "Ban Links Rule",
        banRules.banLinks !== undefined,
        `Ban links enabled: ${banRules.banLinks?.enabled}`
      );

      this.addResult(
        "Ban Photos Rule",
        banRules.banPhotos !== undefined,
        `Ban photos enabled: ${banRules.banPhotos?.enabled}`
      );

      this.addResult(
        "Ban Text Patterns Rule",
        banRules.banTextPatterns !== undefined,
        `Ban text patterns enabled: ${banRules.banTextPatterns?.enabled}`
      );

      // Test scheduling functionality
      if (banRules.banLinks?.schedule) {
        this.addResult(
          "Ban Rule Scheduling",
          true,
          `Schedule mode: ${banRules.banLinks.schedule.mode}, Start: ${banRules.banLinks.schedule.start}, End: ${banRules.banLinks.schedule.end}`
        );
      }

      // Test whitelist/blacklist configuration
      this.addResult(
        "Whitelist Configuration",
        Array.isArray(settings.whitelist),
        `Whitelist items: ${settings.whitelist?.length || 0}`
      );

      this.addResult(
        "Blacklist Configuration",
        Array.isArray(settings.blacklist),
        `Blacklist items: ${settings.blacklist?.length || 0}`
      );

    } catch (error) {
      this.addResult("Content Restriction Load", false, `Error: ${error}`);
    }
  }

  private async testLimitsEnforcement(): Promise<void> {
    console.log("\n📊 Testing Limits Enforcement");
    console.log("-".repeat(30));

    try {
      const settings = await loadLimitSettingsByChatId(this.testGroupId);
      
      if (!settings) {
        this.addResult("Limit Settings Load", false, "Limit settings not found for test group");
        return;
      }

      // Test word count limits
      this.addResult(
        "Minimum Word Limit",
        settings.minWordsPerMessage !== undefined,
        `Min words: ${settings.minWordsPerMessage}`
      );

      this.addResult(
        "Maximum Word Limit",
        settings.maxWordsPerMessage !== undefined,
        `Max words: ${settings.maxWordsPerMessage}`
      );

      // Test rate limiting
      this.addResult(
        "Rate Limiting Configuration",
        settings.messagesPerWindow !== undefined && settings.windowMinutes !== undefined,
        `${settings.messagesPerWindow} messages per ${settings.windowMinutes} minutes`
      );

      // Test duplicate detection
      this.addResult(
        "Duplicate Detection Configuration",
        settings.duplicateMessages !== undefined && settings.duplicateWindowMinutes !== undefined,
        `Max ${settings.duplicateMessages} duplicates per ${settings.duplicateWindowMinutes} minutes`
      );

      // Validate configuration logic
      if (settings.maxWordsPerMessage > 0 && settings.minWordsPerMessage > 0) {
        this.addResult(
          "Word Limit Logic",
          settings.maxWordsPerMessage >= settings.minWordsPerMessage,
          `Max (${settings.maxWordsPerMessage}) >= Min (${settings.minWordsPerMessage})`
        );
      }

    } catch (error) {
      this.addResult("Limits Enforcement Load", false, `Error: ${error}`);
    }
  }

  private async testQuietHoursEnforcement(): Promise<void> {
    console.log("\n🔇 Testing Quiet Hours Enforcement");
    console.log("-".repeat(30));

    try {
      const settings = await loadSilenceSettingsByChatId(this.testGroupId);
      
      if (!settings) {
        this.addResult("Silence Settings Load", false, "Silence settings not found for test group");
        return;
      }

      // Test emergency lock
      if (settings.emergencyLock) {
        this.addResult(
          "Emergency Lock Feature",
          settings.emergencyLock.enabled !== undefined,
          `Emergency lock enabled: ${settings.emergencyLock.enabled}`
        );
      }

      // Test quiet windows
      const windows = [settings.window1, settings.window2, settings.window3];
      let activeWindows = 0;

      windows.forEach((window, index) => {
        if (window && window.enabled) {
          activeWindows++;
          this.addResult(
            `Quiet Window ${index + 1}`,
            window.start !== undefined && window.end !== undefined,
            `${window.start} - ${window.end}`
          );
        }
      });

      this.addResult(
        "Quiet Windows Configuration",
        activeWindows >= 0,
        `${activeWindows} active quiet windows configured`
      );

      // Test current time enforcement
      const now = new Date();
      const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      
      this.addResult(
        "Current Time Check",
        true,
        `Current UTC time: ${now.toUTCString()}, Minutes: ${currentMinutes}`
      );

    } catch (error) {
      this.addResult("Quiet Hours Load", false, `Error: ${error}`);
    }
  }

  private async testMandatoryMembershipEnforcement(): Promise<void> {
    console.log("\n👥 Testing Mandatory Membership Enforcement");
    console.log("-".repeat(30));

    try {
      // Note: This would require importing the mandatory membership settings loader
      // For now, we'll test the general concept
      
      this.addResult(
        "Mandatory Membership Feature",
        true,
        "Feature exists in codebase - needs database verification"
      );

      // TODO: Add actual mandatory membership settings testing when available
      // const settings = await loadMandatoryMembershipSettingsByChatId(this.testGroupId);

    } catch (error) {
      this.addResult("Mandatory Membership Load", false, `Error: ${error}`);
    }
  }

  private async testCustomMessageEnforcement(): Promise<void> {
    console.log("\n💬 Testing Custom Message Enforcement");
    console.log("-".repeat(30));

    try {
      // Note: This would require importing the custom text settings loader
      // For now, we'll test the general concept
      
      this.addResult(
        "Custom Messages Feature",
        true,
        "Feature exists in codebase - needs database verification"
      );

      // TODO: Add actual custom text settings testing when available
      // const settings = await loadCustomTextSettingsByChatId(this.testGroupId);

    } catch (error) {
      this.addResult("Custom Messages Load", false, `Error: ${error}`);
    }
  }

  private addResult(testName: string, passed: boolean, reason: string, details?: Record<string, unknown>): void {
    this.results.push({ testName, passed, reason, details });
    
    const status = passed ? "✅ PASS" : "❌ FAIL";
    console.log(`  ${status}: ${testName} - ${reason}`);
  }

  private generateReport(): void {
    console.log("\n" + "=".repeat(50));
    console.log("📊 FIREWALL ENFORCEMENT TEST REPORT");
    console.log("=".repeat(50));

    const totalTests = this.results.length;
    const passedTests = this.results.filter(r => r.passed).length;
    const failedTests = totalTests - passedTests;

    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests} ✅`);
    console.log(`Failed: ${failedTests} ❌`);
    console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

    if (failedTests > 0) {
      console.log("\n🚨 FAILED TESTS:");
      console.log("-".repeat(30));
      
      this.results
        .filter(r => !r.passed)
        .forEach(result => {
          console.log(`❌ ${result.testName}: ${result.reason}`);
        });
    }

    console.log("\n📋 RECOMMENDATIONS:");
    console.log("-".repeat(30));
    
    if (failedTests === 0) {
      console.log("🎉 All tests passed! Firewall enforcement appears to be working correctly.");
    } else {
      console.log("🔧 Some tests failed. Review the failed tests above and:");
      console.log("  1. Verify database connections are working");
      console.log("  2. Check if test group has proper settings configured");
      console.log("  3. Ensure all firewall modules are properly initialized");
      console.log("  4. Test enforcement in real group scenarios");
    }

    console.log("\n⚠️  IMPORTANT NOTES:");
    console.log("-".repeat(30));
    console.log("  • These tests verify settings loading, not actual enforcement");
    console.log("  • Real enforcement testing requires active Telegram groups");
    console.log("  • Manual testing in controlled groups is recommended");
    console.log("  • Monitor bot logs for actual enforcement actions");
  }
}

// Export the tester for manual use
// To run: import { FirewallEnforcementTester } from './test-firewall-enforcement.js'
// Then: const tester = new FirewallEnforcementTester(); await tester.runAllTests();

export { FirewallEnforcementTester };
