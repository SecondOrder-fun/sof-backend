-- Remove initial_probability_bps field from infofi_markets
-- This field is unnecessary since probabilities are always calculated from current state

ALTER TABLE infofi_markets DROP COLUMN IF EXISTS initial_probability_bps;
