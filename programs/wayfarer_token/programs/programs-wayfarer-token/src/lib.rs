use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

/// PLACEHOLDER program ID — NOT A DEPLOYED PROGRAM. Never deploy or point a
/// server at this ID. Generate a fresh program keypair (`anchor keys list` /
/// `anchor keys sync`), replace this value AND `programs/wayfarer_token/Anchor.toml`,
/// then complete the pre-launch checklist in docs/SECURITY_AUDIT.md
/// (upgrade authority on a multisig, oracle key custody, caps) first.
declare_id!("36MtxdwUM14ZdUjx4ysUjYh2jNsvRRQ2nGooEckCj9Aa");

/// Anchor 0.30 token bridge for Wayfarer Online.
///
/// The program owns a PDA mint authority. A server ORACLE (a key registered in
/// the config at initialize, rotatable by the ADMIN) is the only signer allowed
/// to call `mint_withdraw`, which mints $WAYFARER to a player's ATA after the
/// server debited in-game tokens. Deposits are plain SPL transfers into the
/// treasury that the server observes off-chain.
///
/// Hardening (docs/SECURITY_AUDIT.md, finding SC-1):
/// - `mint_withdraw` requires `oracle == config.oracle` (before: ANY signer
///   could mint unlimited tokens to itself).
/// - `initialize` may only be called by the program's upgrade authority (no
///   front-running the one-time init to become admin/oracle).
/// - on-chain per-transaction cap and per-UTC-day cap (raw units), a running
///   `total_minted` with checked arithmetic, and a `paused` kill switch.
/// - admin-only `set_oracle` / `set_paused` / `set_limits`, and two-step
///   admin transfer is left to the multisig that holds the admin key.
pub const MINT_AUTH_SEED: &[u8] = b"mint";
pub const CONFIG_SEED: &[u8] = b"config";
pub const DECIMALS: u8 = 6;
const SECONDS_PER_DAY: i64 = 86_400;

#[program]
pub mod programs_wayfarer_token {
    use super::*;

    /// Initialize the bridge: create the $WAYFARER mint (PDA authority) and
    /// the config. Only the program's upgrade authority may call it.
    pub fn initialize(
        ctx: Context<Initialize>,
        admin: Pubkey,
        oracle: Pubkey,
        max_per_tx: u64,
        daily_cap: u64,
    ) -> Result<()> {
        require!(max_per_tx > 0 && daily_cap >= max_per_tx, ErrorCode::InvalidLimits);
        let cfg = &mut ctx.accounts.config;
        cfg.admin = admin;
        cfg.oracle = oracle;
        cfg.mint = ctx.accounts.mint.key();
        cfg.mint_authority = ctx.accounts.mint_authority.key();
        cfg.max_per_tx = max_per_tx;
        cfg.daily_cap = daily_cap;
        cfg.day_index = Clock::get()?.unix_timestamp / SECONDS_PER_DAY;
        cfg.minted_today = 0;
        cfg.total_minted = 0;
        cfg.paused = true; // starts paused: the admin unpauses after review
        cfg.bump = ctx.bumps.config;
        cfg.mint_auth_bump = ctx.bumps.mint_authority;
        msg!("wayfarer-bridge initialized: mint={}", ctx.accounts.mint.key());
        Ok(())
    }

    /// Oracle-only: mint `amount` raw units of $WAYFARER to the player's ATA.
    pub fn mint_withdraw(ctx: Context<MintWithdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::ZeroAmount);
        let cfg = &mut ctx.accounts.config;
        require!(!cfg.paused, ErrorCode::Paused);
        require!(amount <= cfg.max_per_tx, ErrorCode::OverTxCap);

        let today = Clock::get()?.unix_timestamp / SECONDS_PER_DAY;
        if today != cfg.day_index {
            cfg.day_index = today;
            cfg.minted_today = 0;
        }
        let minted_today = cfg
            .minted_today
            .checked_add(amount)
            .ok_or(ErrorCode::Overflow)?;
        require!(minted_today <= cfg.daily_cap, ErrorCode::OverDailyCap);
        let total = cfg.total_minted.checked_add(amount).ok_or(ErrorCode::Overflow)?;
        cfg.minted_today = minted_today;
        cfg.total_minted = total;

        let bump = [cfg.mint_auth_bump];
        let seeds: &[&[u8]] = &[MINT_AUTH_SEED, &bump];
        let signer = &[seeds];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.player_token_account.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        msg!(
            "wayfarer-withdraw: {} raw units minted to {}",
            amount,
            ctx.accounts.player_token_account.key()
        );
        Ok(())
    }

    /// Admin-only: rotate the oracle key (e.g. after a server compromise).
    pub fn set_oracle(ctx: Context<AdminOnly>, oracle: Pubkey) -> Result<()> {
        ctx.accounts.config.oracle = oracle;
        Ok(())
    }

    /// Admin-only: pause / unpause minting.
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        Ok(())
    }

    /// Admin-only: change the per-transaction and per-day caps (raw units).
    pub fn set_limits(ctx: Context<AdminOnly>, max_per_tx: u64, daily_cap: u64) -> Result<()> {
        require!(max_per_tx > 0 && daily_cap >= max_per_tx, ErrorCode::InvalidLimits);
        ctx.accounts.config.max_per_tx = max_per_tx;
        ctx.accounts.config.daily_cap = daily_cap;
        Ok(())
    }

    /// Admin-only: hand the admin role to a new key (the multisig).
    pub fn set_admin(ctx: Context<AdminOnly>, admin: Pubkey) -> Result<()> {
        ctx.accounts.config.admin = admin;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Payer for rent; MUST be the program's upgrade authority.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Bridge config account (singleton PDA).
    #[account(
        init,
        payer = payer,
        space = 8 + BridgeConfig::SIZE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, BridgeConfig>,

    /// The $WAYFARER SPL mint, authority = the `mint_authority` PDA.
    #[account(
        init,
        payer = payer,
        mint::decimals = DECIMALS,
        mint::authority = mint_authority
    )]
    pub mint: Account<'info, Mint>,

    /// CHECK: PDA [b"mint"], only used as the mint authority signer.
    #[account(seeds = [MINT_AUTH_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,

    /// This program (to locate its ProgramData account).
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ ErrorCode::Unauthorized)]
    pub program: Program<'info, crate::program::ProgramsWayfarerToken>,

    /// Upgradeable-loader ProgramData: its upgrade authority must sign.
    #[account(constraint = program_data.upgrade_authority_address == Some(payer.key()) @ ErrorCode::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct MintWithdraw<'info> {
    /// Server oracle signer — must be the oracle registered in the config.
    pub oracle: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = mint,
        has_one = mint_authority,
        has_one = oracle @ ErrorCode::Unauthorized
    )]
    pub config: Account<'info, BridgeConfig>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    /// CHECK: PDA [b"mint"] matching config.mint_authority (has_one above).
    #[account(seeds = [MINT_AUTH_SEED], bump = config.mint_auth_bump)]
    pub mint_authority: UncheckedAccount<'info>,

    /// CHECK: the player's wallet; only used to derive/verify the ATA owner.
    pub player: UncheckedAccount<'info>,

    /// The player's canonical ATA for the $WAYFARER mint.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = player
    )]
    pub player_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ ErrorCode::Unauthorized
    )]
    pub config: Account<'info, BridgeConfig>,
}

/// Field order is mirrored by server/economy.js CONFIG_LAYOUT — keep in sync.
#[account]
pub struct BridgeConfig {
    pub admin: Pubkey,
    pub oracle: Pubkey,
    pub mint: Pubkey,
    pub mint_authority: Pubkey,
    pub max_per_tx: u64,
    pub daily_cap: u64,
    pub day_index: i64,
    pub minted_today: u64,
    pub total_minted: u64,
    pub paused: bool,
    pub bump: u8,
    pub mint_auth_bump: u8,
}

impl BridgeConfig {
    pub const SIZE: usize = 32 * 4 + 8 * 5 + 1 + 1 + 1;
}

#[error_code]
pub enum ErrorCode {
    #[msg("Withdraw amount must be greater than zero")]
    ZeroAmount,
    #[msg("Signer is not authorized for this instruction")]
    Unauthorized,
    #[msg("The bridge is paused")]
    Paused,
    #[msg("Amount exceeds the per-transaction cap")]
    OverTxCap,
    #[msg("Amount exceeds the daily mint cap")]
    OverDailyCap,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Invalid limits: max_per_tx must be > 0 and <= daily_cap")]
    InvalidLimits,
}
