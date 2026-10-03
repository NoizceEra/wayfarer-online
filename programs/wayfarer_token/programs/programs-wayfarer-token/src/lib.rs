use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

/// Devnet placeholder program ID for the Wayfarer Token bridge.
/// Replace with the actual devnet pubkey after `anchor deploy`.
declare_id!("36MtxdwUM14ZdUjx4ysUjYh2jNsvRRQ2nGooEckCj9Aa");

/// Anchor 0.30+ token bridge for Wayfarer Online.
/// The program owns a PDA mint authority. The treasury is an off-chain ATA
/// derived from the mint_authority PDA; deposits are observed by the server.
/// - Withdraw: an off-chain server oracle calls `mint_withdraw` to mint
///   $WAYFARER tokens to a player's ATA after they burn in-game tokens.
/// - Deposit: players transfer $WAYFARER tokens into the treasury ATA
///   off-chain; the server observes the transfer and credits in-game tokens.
pub const MINT_AUTH_SEED: &[u8] = b"mint";

#[program]
pub mod programs_wayfarer_token {
    use super::*;

    /// Initialize the bridge: create the $WAYFARER mint.
    /// The mint authority is a PDA so the program can mint via CPI.
    pub fn initialize(ctx: Context<Initialize>, decimals: u8) -> Result<()> {
        require!(decimals <= 9, ErrorCode::InvalidDecimals);
        ctx.accounts.config.mint = ctx.accounts.mint.key();
        ctx.accounts.config.mint_authority = ctx.accounts.mint_authority.key();
        ctx.accounts.config.bump = ctx.bumps.config;
        ctx.accounts.config.mint_auth_bump = ctx.bumps.mint_authority;
        msg!("wayfarer-bridge initialized: mint={}", ctx.accounts.mint.key());
        Ok(())
    }

    /// Server-oracle mints `amount` (with decimals) of $WAYFARER to the
    /// player's ATA. This represents a withdrawal from in-game tokens.
    pub fn mint_withdraw(ctx: Context<MintWithdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::ZeroAmount);

        let seeds = &[MINT_AUTH_SEED, &[ctx.accounts.config.mint_auth_bump]];
        let signer = &[&seeds[..]];

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
            "wayfarer-withdraw: {} tokens minted to {}",
            amount,
            ctx.accounts.player_token_account.key()
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Payer for rent; in practice this is the deployer/server oracle wallet.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Bridge config account, seeded by the program ID.
    #[account(
        init,
        payer = payer,
        space = 8 + BridgeConfig::SIZE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, BridgeConfig>,

    /// The $WAYFARER SPL mint. Created and owned by the `mint_authority` PDA.
    #[account(
        init,
        payer = payer,
        mint::decimals = decimals,
        mint::authority = mint_authority
    )]
    pub mint: Account<'info, Mint>,

    /// PDA mint authority: seeds [b"mint", program_id].
    /// CHECK: safe PDA, only used as a signer/authority.
    #[account(seeds = [MINT_AUTH_SEED], bump)]
    pub mint_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct MintWithdraw<'info> {
    /// Server oracle signer.
    pub oracle: Signer<'info>,

    /// Bridge config.
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        has_one = mint,
        has_one = mint_authority
    )]
    pub config: Account<'info, BridgeConfig>,

    /// The $WAYFARER mint.
    #[account(mut)]
    pub mint: Account<'info, Mint>,

    /// PDA mint authority.
    /// CHECK: safe PDA derived from config.
    #[account(seeds = [MINT_AUTH_SEED], bump = config.mint_auth_bump)]
    pub mint_authority: UncheckedAccount<'info>,

    /// Player wallet receiving tokens.
    /// CHECK: any valid Solana wallet.
    pub player: UncheckedAccount<'info>,

    /// Player's ATA for $WAYFARER.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = player
    )]
    pub player_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[account]
pub struct BridgeConfig {
    pub mint: Pubkey,
    pub mint_authority: Pubkey,
    pub bump: u8,
    pub mint_auth_bump: u8,
}

impl BridgeConfig {
    pub const SIZE: usize = 32 + 32 + 1 + 1;
}

#[error_code]
pub enum ErrorCode {
    #[msg("Withdraw amount must be greater than zero")]
    ZeroAmount,
    #[msg("Mint decimals must be 9 or fewer")]
    InvalidDecimals,
}
