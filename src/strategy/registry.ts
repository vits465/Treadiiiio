import { Strategy } from './strategy.interface';
import { MaCrossoverStrategy } from './maCrossover';
import { RsiMeanReversionStrategy } from './rsiMeanReversion';
import { BollingerBandsStrategy } from './bollingerBands';
import { LossRecoveryStrategy } from './lossRecovery';
import { SmartMoneyConceptsStrategy } from './smartMoneyConcepts';
import { AsianKillZoneStrategy } from './asianKillZone';
import { GridOverlayStrategy } from './gridOverlay';
import { VolatilityArbitrageStrategy } from './volatilityArbitrage';
import { PowerBreakoutStrategy } from './powerBreakout';
import { Scalper1mStrategy } from './scalper1m';
import { logger } from '../logger';

export class StrategyRegistry {
  private static strategies: Map<string, Strategy> = new Map();

  static {
    // Register all strategies available in the repository
    this.register(new MaCrossoverStrategy());
    this.register(new RsiMeanReversionStrategy());
    this.register(new BollingerBandsStrategy());
    this.register(new LossRecoveryStrategy());
    this.register(new SmartMoneyConceptsStrategy());
    this.register(new AsianKillZoneStrategy());
    this.register(new GridOverlayStrategy());
    this.register(new VolatilityArbitrageStrategy());
    this.register(new PowerBreakoutStrategy());
    this.register(new Scalper1mStrategy());
  }

  public static register(strategy: Strategy): void {
    this.strategies.set(strategy.name, strategy);
    logger.debug(`[STRATEGY REGISTRY] Registered strategy: ${strategy.name}`);
  }

  public static get(name: string): Strategy | undefined {
    return this.strategies.get(name);
  }

  public static getAll(): Strategy[] {
    return Array.from(this.strategies.values());
  }

  public static getEnabledStrategies(enabledNames: string[]): Strategy[] {
    const enabled: Strategy[] = [];
    for (const name of enabledNames) {
      const strat = this.get(name);
      if (strat) {
        enabled.push(strat);
      } else if (name !== 'ml_signal') {
        logger.warn(`[STRATEGY REGISTRY] Strategy '${name}' configured in ENABLED_STRATEGIES is not registered.`);
      }
    }
    return enabled;
  }
}
