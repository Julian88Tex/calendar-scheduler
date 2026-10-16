CREATE TYPE "public"."auth_token_purpose" AS ENUM('password_reset', 'email_verification', 'email_change', 'login_method_change');--> statement-breakpoint
CREATE TYPE "public"."oauth_provider" AS ENUM('google', 'microsoft');--> statement-breakpoint
CREATE TYPE "public"."verification_purpose" AS ENUM('booking', 'poll_vote', 'login_method_change', 'phone_verification');--> statement-breakpoint
CREATE TYPE "public"."group_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'declined', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('owner', 'admin', 'user');--> statement-breakpoint
CREATE TYPE "public"."team_role" AS ENUM('manager', 'member');--> statement-breakpoint
CREATE TYPE "public"."file_purpose" AS ENUM('avatar', 'logo', 'team_avatar', 'org_logo', 'import', 'export', 'attachment');--> statement-breakpoint
CREATE TYPE "public"."after_booking" AS ENUM('confirmation_page', 'redirect');--> statement-breakpoint
CREATE TYPE "public"."availability_setting" AS ENUM('host', 'shared');--> statement-breakpoint
CREATE TYPE "public"."booking_method" AS ENUM('instant', 'poll');--> statement-breakpoint
CREATE TYPE "public"."date_range_mode" AS ENUM('calendar_days', 'weekdays', 'available_days');--> statement-breakpoint
CREATE TYPE "public"."date_range_type" AS ENUM('rolling', 'fixed', 'unlimited');--> statement-breakpoint
CREATE TYPE "public"."event_kind" AS ENUM('solo', 'group');--> statement-breakpoint
CREATE TYPE "public"."event_type_scope" AS ENUM('personal', 'shared', 'team');--> statement-breakpoint
CREATE TYPE "public"."event_type_type" AS ENUM('standard', 'adhoc');--> statement-breakpoint
CREATE TYPE "public"."name_format" AS ENUM('full', 'first_last');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('auto', 'calendar_invitation', 'email_confirmation');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('stripe', 'paypal');--> statement-breakpoint
CREATE TYPE "public"."permission_level" AS ENUM('view', 'edit');--> statement-breakpoint
CREATE TYPE "public"."pooling_type" AS ENUM('collective', 'round_robin', 'multi_pool');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('string', 'text', 'single_select', 'multi_select', 'dropdown', 'phone_number');--> statement-breakpoint
CREATE TYPE "public"."reschedule_preference" AS ENUM('reassign', 'same_hosts');--> statement-breakpoint
CREATE TYPE "public"."rr_distribution" AS ENUM('availability', 'equal');--> statement-breakpoint
CREATE TYPE "public"."slot_alignment" AS ENUM('interval_start', 'hour');--> statement-breakpoint
CREATE TYPE "public"."time_zone_display" AS ENUM('auto', 'locked');--> statement-breakpoint
CREATE TYPE "public"."calendar_provider" AS ENUM('google', 'microsoft', 'caldav', 'ics', 'calendly_import');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('active', 'needs_reauth', 'error', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."linked_event_purpose" AS ENUM('meeting', 'buffer_before', 'buffer_after', 'one_off_hold', 'poll_hold');--> statement-breakpoint
CREATE TYPE "public"."linked_event_status" AS ENUM('pending', 'synced', 'failed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."conferencing_provider" AS ENUM('zoom', 'webex', 'gotomeeting');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('user', 'system', 'api', 'invitee');--> statement-breakpoint
CREATE TYPE "public"."booking_source" AS ENUM('booking_page', 'single_use_link', 'one_off', 'poll', 'host', 'api', 'routing_form', 'calendar_sync');--> statement-breakpoint
CREATE TYPE "public"."canceler_type" AS ENUM('host', 'invitee', 'system');--> statement-breakpoint
CREATE TYPE "public"."event_host_role" AS ENUM('organizer', 'cohost', 'assigned');--> statement-breakpoint
CREATE TYPE "public"."invitee_status" AS ENUM('active', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."meeting_activity_type" AS ENUM('booked', 'rescheduled_from', 'rescheduled_to', 'canceled', 'invitee_canceled', 'invitee_added', 'invitee_removed', 'no_show_marked', 'no_show_unmarked', 'notes_updated', 'email_sent', 'email_failed', 'sms_sent', 'sms_failed', 'calendar_synced', 'calendar_failed', 'conference_created', 'conference_failed', 'notification_fallback', 'reconfirmation_requested', 'reconfirmed', 'payment_succeeded', 'payment_refunded', 'host_reassigned', 'invitee_limit_changed', 'location_changed', 'buffers_changed', 'workflow_sent', 'workflow_skipped');--> statement-breakpoint
CREATE TYPE "public"."provision_status" AS ENUM('pending', 'done', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."reservation_kind" AS ENUM('payment', 'email_verification');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('pending', 'completed', 'expired', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."scheduled_event_status" AS ENUM('active', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."scheduling_method" AS ENUM('instant_book', 'api');--> statement-breakpoint
CREATE TYPE "public"."one_off_date_setting" AS ENUM('spots', 'date_range', 'days_in_future');--> statement-breakpoint
CREATE TYPE "public"."one_off_status" AS ENUM('pending', 'booked', 'expired', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."single_use_link_status" AS ENUM('active', 'booked', 'expired', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."poll_activity_type" AS ENUM('created', 'edited', 'options_added', 'options_removed', 'invited', 'voted', 'vote_changed', 'declined', 'participant_removed', 'commented', 'comment_deleted', 'reminder_sent', 'voting_closed', 'voting_reopened', 'booked', 'reopened', 'rebooked', 'canceled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."poll_notify_mode" AS ENUM('instant', 'daily_digest', 'off');--> statement-breakpoint
CREATE TYPE "public"."poll_participant_source" AS ENUM('link', 'invite', 'host_added');--> statement-breakpoint
CREATE TYPE "public"."poll_participant_status" AS ENUM('invited', 'responded', 'declined');--> statement-breakpoint
CREATE TYPE "public"."poll_reminder_mode" AS ENUM('off', 'smart', 'custom');--> statement-breakpoint
CREATE TYPE "public"."poll_results_visibility" AS ENUM('host_only', 'counts_only', 'after_vote', 'everyone');--> statement-breakpoint
CREATE TYPE "public"."poll_status" AS ENUM('open', 'closed', 'booked', 'canceled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."poll_time_zone_mode" AS ENUM('auto', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."poll_vote_choice" AS ENUM('yes', 'if_need_be', 'no');--> statement-breakpoint
CREATE TYPE "public"."basic_notification_kind" AS ENUM('email_reminder', 'text_reminder', 'email_follow_up');--> statement-breakpoint
CREATE TYPE "public"."workflow_action" AS ENUM('email_invitees', 'email_host', 'email_other', 'sms_invitees', 'sms_host', 'sms_other');--> statement-breakpoint
CREATE TYPE "public"."workflow_execution_status" AS ENUM('scheduled', 'sent', 'skipped', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."workflow_scope" AS ENUM('user', 'team');--> statement-breakpoint
CREATE TYPE "public"."workflow_trigger" AS ENUM('booked', 'before_start', 'starts', 'rescheduled', 'ends', 'canceled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('queued', 'sending', 'sent', 'stored', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sms_status" AS ENUM('queued', 'sent', 'stored', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'canceled', 'dead');--> statement-breakpoint
CREATE TYPE "public"."routing_form_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."routing_question_type" AS ENUM('name', 'email', 'phone', 'text', 'textarea', 'select', 'radios', 'checkboxes', 'number');--> statement-breakpoint
CREATE TYPE "public"."contact_source" AS ENUM('booking', 'manual', 'import', 'api', 'poll', 'routing_form');--> statement-breakpoint
CREATE TYPE "public"."custom_field_type" AS ENUM('text', 'single_select', 'number', 'boolean', 'currency', 'date', 'tags');--> statement-breakpoint
CREATE TYPE "public"."analytics_event_kind" AS ENUM('profile_page_viewed', 'event_type_viewed', 'date_and_time_selected', 'event_scheduled', 'routing_form_viewed', 'routing_form_submitted', 'poll_viewed');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'succeeded', 'failed', 'giving_up');--> statement-breakpoint
CREATE TYPE "public"."webhook_scope" AS ENUM('organization', 'user', 'group');--> statement-breakpoint
CREATE TYPE "public"."webhook_state" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."coupon_kind" AS ENUM('percent', 'amount');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."data_deletion_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."data_deletion_type" AS ENUM('emails', 'date_range');--> statement-breakpoint
CREATE TYPE "public"."import_run_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_source" AS ENUM('calendly');--> statement-breakpoint
CREATE TABLE "app_secrets" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"purpose" "auth_token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"email" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "oauth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "oauth_provider" NOT NULL,
	"provider_account_id" text NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_buckets_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"two_factor_pending" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trusted_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_normalized" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "two_factor_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text,
	"name" text NOT NULL,
	"slug" text,
	"avatar_file_id" uuid,
	"avatar_url" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"time_format" text DEFAULT '12h' NOT NULL,
	"date_format" text DEFAULT 'MM/DD/YYYY' NOT NULL,
	"week_start" smallint DEFAULT 0 NOT NULL,
	"country" text,
	"welcome_message" text DEFAULT 'Welcome to my scheduling page. Please follow the instructions to add an event to my calendar.' NOT NULL,
	"destination_calendar_id" uuid,
	"default_location" jsonb,
	"meeting_limit_day" integer,
	"meeting_limit_week" integer,
	"meeting_limit_month" integer,
	"holiday_country" text,
	"logo_file_id" uuid,
	"show_branding" boolean DEFAULT true NOT NULL,
	"brand_colors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notification_prefs" jsonb DEFAULT '{"pollVotes":"instant","calendarProblems":true,"dailyAgenda":false,"hostAdded":true,"noReplyInviteeEmails":false}'::jsonb NOT NULL,
	"booking_email_verification_default" boolean DEFAULT false NOT NULL,
	"ga4_measurement_id" text,
	"meta_pixel_id" text,
	"phone_number" text,
	"phone_verified_at" timestamp with time zone,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"two_factor_secret_enc" text,
	"is_instance_admin" boolean DEFAULT false NOT NULL,
	"onboarding_step" text,
	"onboarding_completed_at" timestamp with time zone,
	"use_case" text,
	"usage_mode" text,
	"last_login_at" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	"created_via_invitation_id" uuid,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "verification_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" "verification_purpose" NOT NULL,
	"email_normalized" text,
	"phone" text,
	"code_hash" text NOT NULL,
	"context_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_memberships" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "group_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_memberships_group_id_user_id_role_pk" PRIMARY KEY("group_id","user_id","role")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handles" (
	"slug" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handles_one_owner" CHECK (num_nonnulls(user_id, team_id) = 1)
);
--> statement-breakpoint
CREATE TABLE "organization_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"role" "org_role" DEFAULT 'user' NOT NULL,
	"team_ids" uuid[] DEFAULT '{}' NOT NULL,
	"token_hash" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" uuid,
	"accepted_user_id" uuid,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_invitations_role_ck" CHECK (role <> 'owner')
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "org_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"logo_file_id" uuid,
	"apply_branding_to_members" boolean DEFAULT false NOT NULL,
	"show_branding" boolean DEFAULT true NOT NULL,
	"settings" jsonb DEFAULT '{"sharedEventTypeCreators":"everyone","invitePermission":"admins","defaultEmailVerification":false}'::jsonb NOT NULL,
	"plan" text DEFAULT 'self_hosted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "team_memberships" (
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "team_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_memberships_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"welcome_message" text,
	"avatar_file_id" uuid,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"organization_id" uuid,
	"purpose" "file_purpose" NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea",
	"blob_url" text,
	"width" integer,
	"height" integer,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_date_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"date" date NOT NULL,
	"intervals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"weekly_hours" jsonb NOT NULL,
	"event_type_id" uuid,
	"single_use_link_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_holiday_overrides" (
	"user_id" uuid NOT NULL,
	"holiday_key" text NOT NULL,
	"observed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_holiday_overrides_user_id_holiday_key_pk" PRIMARY KEY("user_id","holiday_key")
);
--> statement-breakpoint
CREATE TABLE "event_type_host_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type_id" uuid NOT NULL,
	"name" text DEFAULT 'Pool 1' NOT NULL,
	"distribution" "rr_distribution" DEFAULT 'availability' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"counts_reset_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_type_hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"pool_id" uuid,
	"priority" smallint DEFAULT 3 NOT NULL,
	"schedule_id" uuid,
	"location_override" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_type_permissions" (
	"event_type_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"level" "permission_level" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_type_permissions_event_type_id_user_id_pk" PRIMARY KEY("event_type_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "event_type_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"type" "question_type" NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"answer_choices" text[] DEFAULT '{}' NOT NULL,
	"include_other" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"team_id" uuid,
	"scope" "event_type_scope" DEFAULT 'personal' NOT NULL,
	"type" "event_type_type" DEFAULT 'standard' NOT NULL,
	"booking_method" "booking_method" DEFAULT 'instant' NOT NULL,
	"kind" "event_kind" DEFAULT 'solo' NOT NULL,
	"pooling_type" "pooling_type",
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"share_code" text,
	"color" text DEFAULT '#8247f5' NOT NULL,
	"description_html" text,
	"description_plain" text,
	"internal_note" text,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"secret" boolean DEFAULT false NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"duration_options" integer[],
	"locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"schedule_id" uuid,
	"availability_setting" "availability_setting" DEFAULT 'host' NOT NULL,
	"date_range_type" date_range_type DEFAULT 'rolling' NOT NULL,
	"date_range_days" integer DEFAULT 60 NOT NULL,
	"date_range_mode" date_range_mode DEFAULT 'calendar_days' NOT NULL,
	"date_range_start" date,
	"date_range_end" date,
	"minimum_notice_minutes" integer DEFAULT 240 NOT NULL,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"slot_increment_minutes" integer DEFAULT 30 NOT NULL,
	"slot_alignment" "slot_alignment" DEFAULT 'interval_start' NOT NULL,
	"limit_per_day" integer,
	"limit_per_week" integer,
	"limit_per_month" integer,
	"time_zone_display" time_zone_display DEFAULT 'auto' NOT NULL,
	"locked_time_zone" text,
	"free_busy_exceptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"name_format" "name_format" DEFAULT 'full' NOT NULL,
	"allow_guests" boolean DEFAULT true NOT NULL,
	"autofill_invitee" boolean DEFAULT false NOT NULL,
	"require_email_verification" boolean DEFAULT false NOT NULL,
	"collect_marketing_consent" boolean DEFAULT false NOT NULL,
	"max_invitees" integer DEFAULT 1 NOT NULL,
	"show_remaining_spots" boolean DEFAULT false NOT NULL,
	"reschedule_preference" "reschedule_preference" DEFAULT 'reassign' NOT NULL,
	"notification_type" "notification_type" DEFAULT 'auto' NOT NULL,
	"notification_templates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"include_cancel_reschedule_links" boolean DEFAULT true NOT NULL,
	"include_answers_in_notifications" boolean DEFAULT true NOT NULL,
	"cancellation_policy" text,
	"require_cancel_reason" boolean DEFAULT false NOT NULL,
	"change_cutoff_minutes" integer,
	"after_booking" "after_booking" DEFAULT 'confirmation_page' NOT NULL,
	"redirect_url" text,
	"redirect_pass_details" boolean DEFAULT false NOT NULL,
	"schedule_another_enabled" boolean DEFAULT true NOT NULL,
	"schedule_another_label" text DEFAULT 'Schedule another event' NOT NULL,
	"confirmation_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payment_enabled" boolean DEFAULT false NOT NULL,
	"payment_provider" "payment_provider",
	"price_minor" integer,
	"currency" text,
	"payment_terms" text,
	"destination_calendar_id" uuid,
	"calendar_event_title_template" text,
	"organizer_user_id" uuid,
	"admin_managed" boolean DEFAULT false NOT NULL,
	"is_managed_template" boolean DEFAULT false NOT NULL,
	"managed_template_id" uuid,
	"managed_locks" jsonb,
	"managed_synced_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "event_types_duration_ck" CHECK (duration_minutes between 1 and 720),
	CONSTRAINT "event_types_seats_ck" CHECK (max_invitees between 1 and 9999),
	CONSTRAINT "event_types_group_durations_ck" CHECK (kind <> 'group' or duration_options is null)
);
--> statement-breakpoint
CREATE TABLE "managed_event_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_event_type_id" uuid NOT NULL,
	"user_id" uuid,
	"team_id" uuid,
	"copy_event_type_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "calendar_provider" NOT NULL,
	"account_email" text,
	"display_name" text,
	"provider_account_id" text,
	"oauth_account_id" uuid,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"token_expires_at" timestamp with time zone,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"caldav_server_url" text,
	"caldav_username" text,
	"caldav_password_enc" text,
	"caldav_principal_url" text,
	"ics_url_enc" text,
	"ics_etag" text,
	"ics_last_modified" text,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"problem_notified_at" timestamp with time zone,
	"unavailable_statuses" text[] DEFAULT '{"busy","tentative","oof","workingElsewhere"}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_linked_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"connection_id" uuid,
	"calendar_id" uuid,
	"purpose" "linked_event_purpose" NOT NULL,
	"scheduled_event_id" uuid,
	"one_off_meeting_id" uuid,
	"poll_id" uuid,
	"poll_option_id" uuid,
	"one_off_spot_id" uuid,
	"external_id" text,
	"ical_uid" text,
	"etag" text,
	"synced_start_at" timestamp with time zone,
	"synced_end_at" timestamp with time zone,
	"status" "linked_event_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_sync_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"fetch_lease_until" timestamp with time zone,
	"fetch_lease_holder" text
);
--> statement-breakpoint
CREATE TABLE "calendar_watch_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"provider" "calendar_provider" NOT NULL,
	"channel_id" text NOT NULL,
	"resource_id" text,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"timezone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"can_write" boolean DEFAULT false NOT NULL,
	"check_conflicts" boolean DEFAULT false NOT NULL,
	"include_buffers" boolean DEFAULT false NOT NULL,
	"sync_changes" boolean DEFAULT true NOT NULL,
	"sync_token" text,
	"ctag" text,
	"allowed_online_meeting_providers" text[] DEFAULT '{}' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"ical_uid" text,
	"recurring_event_id" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"all_day_start_date" date,
	"all_day_end_date" date,
	"title" text,
	"busy" boolean NOT NULL,
	"show_as" text,
	"status" text,
	"is_own" boolean DEFAULT false NOT NULL,
	"remote_updated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conferencing_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "conferencing_provider" NOT NULL,
	"account_email" text,
	"provider_user_id" text,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"token_expires_at" timestamp with time zone,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"last_error" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocked_invitees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text,
	"email_normalized" text,
	"domain" text,
	"reason" text,
	"source_invitee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocked_one_target" CHECK (num_nonnulls(email_normalized, domain) = 1)
);
--> statement-breakpoint
CREATE TABLE "booking_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "reservation_kind" NOT NULL,
	"status" "reservation_status" DEFAULT 'pending' NOT NULL,
	"event_type_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"buffered_start_at" timestamp with time zone NOT NULL,
	"buffered_end_at" timestamp with time zone NOT NULL,
	"host_user_ids" uuid[] NOT NULL,
	"assignment" jsonb,
	"is_group_seat" boolean DEFAULT false NOT NULL,
	"invitee_email_normalized" text NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_invitee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitee_guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitee_id" uuid NOT NULL,
	"scheduled_event_id" uuid NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitee_no_shows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitee_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_event_id" uuid NOT NULL,
	"event_type_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"timezone" text,
	"detected_timezone" text,
	"time_format" text,
	"locale" text,
	"status" "invitee_status" DEFAULT 'active' NOT NULL,
	"questions_and_answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"location_answer" jsonb,
	"text_reminder_number" text,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"salesforce_uuid" text,
	"rescheduled" boolean DEFAULT false NOT NULL,
	"old_invitee_id" uuid,
	"new_invitee_id" uuid,
	"routing_form_submission_id" uuid,
	"poll_participant_id" uuid,
	"contact_id" uuid,
	"scheduling_method" "scheduling_method",
	"scheduled_by_user_id" uuid,
	"reconfirmation_requested_at" timestamp with time zone,
	"reconfirmed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"canceler_type" "canceler_type",
	"canceled_by_user_id" uuid,
	"canceled_by_name" text,
	"reschedule_reason" text,
	"email_verified_at" timestamp with time zone,
	"ip_hash" text,
	"anonymized_at" timestamp with time zone,
	"client_request_id" text,
	"reservation_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_event_id" uuid NOT NULL,
	"invitee_id" uuid,
	"type" "meeting_activity_type" NOT NULL,
	"actor_type" "actor_type" DEFAULT 'system' NOT NULL,
	"actor_user_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_event_hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type_id" uuid NOT NULL,
	"pool_id" uuid,
	"role" "event_host_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"buffered_start_at" timestamp with time zone NOT NULL,
	"buffered_end_at" timestamp with time zone NOT NULL,
	"assignment_reason" text,
	"assigned_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "scheduled_event_status" DEFAULT 'active' NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"is_group" boolean DEFAULT false NOT NULL,
	"invitees_limit" integer DEFAULT 1 NOT NULL,
	"location" jsonb NOT NULL,
	"organizer_user_id" uuid NOT NULL,
	"source" "booking_source" DEFAULT 'booking_page' NOT NULL,
	"single_use_link_id" uuid,
	"one_off_meeting_id" uuid,
	"poll_id" uuid,
	"settings_snapshot" jsonb NOT NULL,
	"meeting_notes_html" text,
	"meeting_notes_plain" text,
	"ics_uid" text NOT NULL,
	"ics_sequence" integer DEFAULT 0 NOT NULL,
	"provider_ical_uid" text,
	"invitation_url" text,
	"rescheduled_from_event_id" uuid,
	"provision_status" "provision_status" DEFAULT 'pending' NOT NULL,
	"provision_error" text,
	"provisioned_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"canceler_type" "canceler_type",
	"canceled_by_user_id" uuid,
	"canceled_by_name" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sched_times_ck" CHECK (end_at > start_at)
);
--> statement-breakpoint
CREATE TABLE "availability_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type_id" uuid,
	"single_use_link_id" uuid,
	"recipient_email" text NOT NULL,
	"recipient_email_normalized" text NOT NULL,
	"recipient_name" text,
	"contact_id" uuid,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"reminder_days" integer,
	"sent_at" timestamp with time zone NOT NULL,
	"email_outbox_id" uuid,
	"booked_invitee_id" uuid,
	"booked_at" timestamp with time zone,
	"follow_up_sent_at" timestamp with time zone,
	"follow_up_dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "one_off_meeting_spots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"one_off_meeting_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"overlapped_external_ids" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "one_off_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"event_type_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"timezone" text NOT NULL,
	"date_setting" "one_off_date_setting" DEFAULT 'spots' NOT NULL,
	"date_range_start" date,
	"date_range_end" date,
	"days_in_future" integer,
	"only_weekdays" boolean DEFAULT false NOT NULL,
	"reserve_times" boolean DEFAULT false NOT NULL,
	"status" "one_off_status" DEFAULT 'pending' NOT NULL,
	"booked_scheduled_event_id" uuid,
	"booked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "single_use_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"event_type_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"name_override" text,
	"duration_override" integer,
	"duration_options_override" integer[],
	"locations_override" jsonb,
	"schedule_id" uuid,
	"date_range_override" jsonb,
	"hide_location" boolean DEFAULT false NOT NULL,
	"contact_id" uuid,
	"prefill_name" text,
	"prefill_email" text,
	"max_event_count" integer DEFAULT 1 NOT NULL,
	"booked_count" integer DEFAULT 0 NOT NULL,
	"status" "single_use_link_status" DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'ui' NOT NULL,
	"last_booked_scheduled_event_id" uuid,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meeting_poll_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"type" "poll_activity_type" NOT NULL,
	"participant_id" uuid,
	"actor_user_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_poll_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"participant_id" uuid,
	"author_user_id" uuid,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"visibility" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_poll_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"all_day_date" date,
	"duration_minutes" integer NOT NULL,
	"position" integer NOT NULL,
	"suggested_by_participant_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_option_shape_ck" CHECK ((starts_at is not null and ends_at is not null and all_day_date is null and ends_at > starts_at) or (starts_at is null and ends_at is null and all_day_date is not null))
);
--> statement-breakpoint
CREATE TABLE "meeting_poll_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"email_normalized" text,
	"user_id" uuid,
	"timezone" text,
	"locale" text,
	"status" "poll_participant_status" NOT NULL,
	"source" "poll_participant_source" NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"subscribed_to_updates" boolean DEFAULT false NOT NULL,
	"edit_token_hash" text NOT NULL,
	"invite_token_hash" text,
	"email_verified_at" timestamp with time zone,
	"invited_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"last_submitted_at" timestamp with time zone,
	"reminder_count" integer DEFAULT 0 NOT NULL,
	"last_reminded_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meeting_poll_votes" (
	"participant_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"poll_id" uuid NOT NULL,
	"choice" "poll_vote_choice" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_poll_votes_participant_id_option_id_pk" PRIMARY KEY("participant_id","option_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description_html" text,
	"default_duration_minutes" integer NOT NULL,
	"location" jsonb,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text NOT NULL,
	"time_zone_mode" "poll_time_zone_mode" DEFAULT 'auto' NOT NULL,
	"status" "poll_status" DEFAULT 'open' NOT NULL,
	"results_visibility" "poll_results_visibility" DEFAULT 'host_only' NOT NULL,
	"allow_if_need_be" boolean DEFAULT false NOT NULL,
	"require_email" boolean DEFAULT true NOT NULL,
	"hide_invitees" boolean DEFAULT false NOT NULL,
	"verify_email" boolean DEFAULT false NOT NULL,
	"allow_comments" boolean DEFAULT false NOT NULL,
	"allow_suggestions" boolean DEFAULT false NOT NULL,
	"max_votes_per_option" integer,
	"max_choices_per_participant" integer,
	"deadline_at" timestamp with time zone,
	"reserve_times" boolean DEFAULT false NOT NULL,
	"notify_mode" "poll_notify_mode" DEFAULT 'instant' NOT NULL,
	"reminder_mode" "poll_reminder_mode" DEFAULT 'smart' NOT NULL,
	"reminder_offsets" jsonb,
	"auto_book" boolean DEFAULT false NOT NULL,
	"count_host_preference" boolean DEFAULT false NOT NULL,
	"host_preferences" jsonb,
	"booked_option_id" uuid,
	"booked_scheduled_event_id" uuid,
	"booked_at" timestamp with time zone,
	"booked_by_user_id" uuid,
	"voting_closed_at" timestamp with time zone,
	"reopened_at" timestamp with time zone,
	"first_invite_sent_at" timestamp with time zone,
	"host_last_viewed_at" timestamp with time zone,
	"send_meeting_reminders" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_slug_redirects" (
	"old_slug" text PRIMARY KEY NOT NULL,
	"poll_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_opt_outs" (
	"phone" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_event_types" (
	"workflow_id" uuid NOT NULL,
	"event_type_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_event_types_workflow_id_event_type_id_pk" PRIMARY KEY("workflow_id","event_type_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid,
	"step_id" uuid,
	"scheduled_event_id" uuid NOT NULL,
	"invitee_id" uuid,
	"trigger" "workflow_trigger" NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"status" "workflow_execution_status" DEFAULT 'scheduled' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"job_id" uuid,
	"skip_reason" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"email_outbox_id" uuid,
	"sms_message_id" uuid,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"action" "workflow_action" NOT NULL,
	"recipients" text[] DEFAULT '{}' NOT NULL,
	"subject" text,
	"body_html" text,
	"body_text" text,
	"include_cancel_reschedule_links" boolean DEFAULT true NOT NULL,
	"include_guests" boolean DEFAULT false NOT NULL,
	"reply_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"team_id" uuid,
	"scope" "workflow_scope" DEFAULT 'user' NOT NULL,
	"name" text NOT NULL,
	"trigger" "workflow_trigger" NOT NULL,
	"offset_minutes" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_basic" boolean DEFAULT false NOT NULL,
	"basic_kind" "basic_notification_kind",
	"basic_event_type_id" uuid,
	"template_key" text,
	"managed_template_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workflows_offset_ck" CHECK (offset_minutes between 0 and 525600)
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"to_addresses" text[] NOT NULL,
	"cc_addresses" text[] DEFAULT '{}' NOT NULL,
	"bcc_addresses" text[] DEFAULT '{}' NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text,
	"reply_to" text,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ics_method" text,
	"ics" text,
	"template" text NOT NULL,
	"category" text NOT NULL,
	"status" "email_status" DEFAULT 'queued' NOT NULL,
	"provider" text,
	"provider_message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"idempotency_key" text NOT NULL,
	"related_user_id" uuid,
	"scheduled_event_id" uuid,
	"invitee_id" uuid,
	"poll_id" uuid,
	"workflow_execution_id" uuid,
	"body_purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sms_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"to_number" text NOT NULL,
	"from_number" text,
	"body" text NOT NULL,
	"status" "sms_status" DEFAULT 'queued' NOT NULL,
	"provider" text,
	"provider_sid" text,
	"segments" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"idempotency_key" text NOT NULL,
	"scheduled_event_id" uuid,
	"invitee_id" uuid,
	"workflow_execution_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"organization_id" uuid,
	"actor" jsonb,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"locked_until" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"result" jsonb,
	"idempotency_key" text,
	"group_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "routing_form_permissions" (
	"form_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"level" "permission_level" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routing_form_permissions_form_id_user_id_pk" PRIMARY KEY("form_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "routing_form_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" "routing_question_type" NOT NULL,
	"label" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"choices" text[] DEFAULT '{}' NOT NULL,
	"placeholder" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"map_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_form_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text,
	"conditions" jsonb NOT NULL,
	"destination" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"answers" jsonb NOT NULL,
	"tracking" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"matched_route_id" uuid,
	"invitee_id" uuid,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "routing_form_status" DEFAULT 'draft' NOT NULL,
	"headline" text,
	"description_html" text,
	"submit_label" text DEFAULT 'Submit' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"fallback" jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_custom_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"field_type" "custom_field_type" NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"currency" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_custom_field_values" (
	"contact_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_custom_field_values_contact_id_definition_id_pk" PRIMARY KEY("contact_id","definition_id")
);
--> statement-breakpoint
CREATE TABLE "contact_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_list_members" (
	"list_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_list_members_list_id_contact_id_pk" PRIMARY KEY("list_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "contact_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body_html" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"text" text NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"primary_email" text,
	"phones" text[] DEFAULT '{}' NOT NULL,
	"timezone" text,
	"job_title" text,
	"company" text,
	"city" text,
	"state" text,
	"country" text,
	"linkedin" text,
	"creation_source" "contact_source" NOT NULL,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"last_meeting_at" timestamp with time zone,
	"next_meeting_at" timestamp with time zone,
	"last_interaction_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "analytics_event_kind" NOT NULL,
	"organization_id" uuid,
	"user_id" uuid,
	"team_id" uuid,
	"event_type_id" uuid,
	"routing_form_id" uuid,
	"poll_id" uuid,
	"session_id" text,
	"embed" boolean DEFAULT false NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"referrer_host" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_used_ip" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"domain_event_id" uuid,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"response_status" integer,
	"response_body" text,
	"duration_ms" integer,
	"error" text,
	"redelivery_of_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" "webhook_scope" NOT NULL,
	"user_id" uuid,
	"group_id" uuid,
	"callback_url" text NOT NULL,
	"events" text[] NOT NULL,
	"signing_key_enc" text NOT NULL,
	"state" "webhook_state" DEFAULT 'active' NOT NULL,
	"retry_started_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"creator_user_id" uuid,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"payment_id" uuid,
	"invitee_email_normalized" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"code_normalized" text NOT NULL,
	"name" text NOT NULL,
	"kind" "coupon_kind" NOT NULL,
	"percent_off" integer,
	"amount_off_minor" integer,
	"currency" text,
	"first_time_only" boolean DEFAULT false NOT NULL,
	"max_redemptions" integer,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "event_type_coupons" (
	"event_type_id" uuid NOT NULL,
	"coupon_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_type_coupons_event_type_id_coupon_id_pk" PRIMARY KEY("event_type_id","coupon_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invitee_id" uuid,
	"scheduled_event_id" uuid,
	"reservation_id" uuid,
	"provider" "payment_provider" NOT NULL,
	"external_id" text NOT NULL,
	"external_charge_id" text,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"discount_minor" integer DEFAULT 0 NOT NULL,
	"coupon_id" uuid,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"terms_snapshot" text,
	"receipt_url" text,
	"refunded_minor" integer DEFAULT 0 NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" uuid,
	"actor_label" text,
	"action" text NOT NULL,
	"namespace" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"user_agent" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "data_deletion_type" NOT NULL,
	"params" jsonb NOT NULL,
	"status" "data_deletion_status" DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" uuid,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" "import_source" NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"imported_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" "import_source" NOT NULL,
	"status" "import_run_status" DEFAULT 'pending' NOT NULL,
	"options" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor_recovery_codes" ADD CONSTRAINT "two_factor_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_file_id_files_id_fk" FOREIGN KEY ("avatar_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_destination_calendar_id_calendars_id_fk" FOREIGN KEY ("destination_calendar_id") REFERENCES "public"."calendars"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_logo_file_id_files_id_fk" FOREIGN KEY ("logo_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_created_via_invitation_id_organization_invitations_id_fk" FOREIGN KEY ("created_via_invitation_id") REFERENCES "public"."organization_invitations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handles" ADD CONSTRAINT "handles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handles" ADD CONSTRAINT "handles_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_logo_file_id_files_id_fk" FOREIGN KEY ("logo_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_avatar_file_id_files_id_fk" FOREIGN KEY ("avatar_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_date_overrides" ADD CONSTRAINT "availability_date_overrides_schedule_id_availability_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."availability_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_schedules" ADD CONSTRAINT "availability_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_schedules" ADD CONSTRAINT "availability_schedules_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_schedules" ADD CONSTRAINT "availability_schedules_single_use_link_id_single_use_links_id_fk" FOREIGN KEY ("single_use_link_id") REFERENCES "public"."single_use_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_holiday_overrides" ADD CONSTRAINT "user_holiday_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_host_pools" ADD CONSTRAINT "event_type_host_pools_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_hosts" ADD CONSTRAINT "event_type_hosts_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_hosts" ADD CONSTRAINT "event_type_hosts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_hosts" ADD CONSTRAINT "event_type_hosts_schedule_id_availability_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."availability_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_permissions" ADD CONSTRAINT "event_type_permissions_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_permissions" ADD CONSTRAINT "event_type_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_questions" ADD CONSTRAINT "event_type_questions_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_schedule_id_availability_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."availability_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_destination_calendar_id_calendars_id_fk" FOREIGN KEY ("destination_calendar_id") REFERENCES "public"."calendars"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_organizer_user_id_users_id_fk" FOREIGN KEY ("organizer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_managed_template_id_event_types_id_fk" FOREIGN KEY ("managed_template_id") REFERENCES "public"."event_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_event_assignments" ADD CONSTRAINT "managed_event_assignments_template_event_type_id_event_types_id_fk" FOREIGN KEY ("template_event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_event_assignments" ADD CONSTRAINT "managed_event_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_event_assignments" ADD CONSTRAINT "managed_event_assignments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_event_assignments" ADD CONSTRAINT "managed_event_assignments_copy_event_type_id_event_types_id_fk" FOREIGN KEY ("copy_event_type_id") REFERENCES "public"."event_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_oauth_account_id_oauth_accounts_id_fk" FOREIGN KEY ("oauth_account_id") REFERENCES "public"."oauth_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_linked_events" ADD CONSTRAINT "calendar_linked_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_linked_events" ADD CONSTRAINT "calendar_linked_events_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_linked_events" ADD CONSTRAINT "calendar_linked_events_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_linked_events" ADD CONSTRAINT "calendar_linked_events_scheduled_event_id_scheduled_events_id_fk" FOREIGN KEY ("scheduled_event_id") REFERENCES "public"."scheduled_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_linked_events" ADD CONSTRAINT "calendar_linked_events_one_off_meeting_id_one_off_meetings_id_fk" FOREIGN KEY ("one_off_meeting_id") REFERENCES "public"."one_off_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_linked_events" ADD CONSTRAINT "calendar_linked_events_poll_id_meeting_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."meeting_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_linked_events" ADD CONSTRAINT "calendar_linked_events_poll_option_id_meeting_poll_options_id_fk" FOREIGN KEY ("poll_option_id") REFERENCES "public"."meeting_poll_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_linked_events" ADD CONSTRAINT "calendar_linked_events_one_off_spot_id_one_off_meeting_spots_id_fk" FOREIGN KEY ("one_off_spot_id") REFERENCES "public"."one_off_meeting_spots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sync_windows" ADD CONSTRAINT "calendar_sync_windows_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_watch_channels" ADD CONSTRAINT "calendar_watch_channels_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_events" ADD CONSTRAINT "external_events_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conferencing_connections" ADD CONSTRAINT "conferencing_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_invitees" ADD CONSTRAINT "blocked_invitees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_reservations" ADD CONSTRAINT "booking_reservations_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitee_guests" ADD CONSTRAINT "invitee_guests_invitee_id_invitees_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."invitees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitee_guests" ADD CONSTRAINT "invitee_guests_scheduled_event_id_scheduled_events_id_fk" FOREIGN KEY ("scheduled_event_id") REFERENCES "public"."scheduled_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitee_no_shows" ADD CONSTRAINT "invitee_no_shows_invitee_id_invitees_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."invitees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitees" ADD CONSTRAINT "invitees_scheduled_event_id_scheduled_events_id_fk" FOREIGN KEY ("scheduled_event_id") REFERENCES "public"."scheduled_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitees" ADD CONSTRAINT "invitees_routing_form_submission_id_routing_form_submissions_id_fk" FOREIGN KEY ("routing_form_submission_id") REFERENCES "public"."routing_form_submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitees" ADD CONSTRAINT "invitees_poll_participant_id_meeting_poll_participants_id_fk" FOREIGN KEY ("poll_participant_id") REFERENCES "public"."meeting_poll_participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitees" ADD CONSTRAINT "invitees_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitees" ADD CONSTRAINT "invitees_reservation_id_booking_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."booking_reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_activity" ADD CONSTRAINT "meeting_activity_scheduled_event_id_scheduled_events_id_fk" FOREIGN KEY ("scheduled_event_id") REFERENCES "public"."scheduled_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_event_hosts" ADD CONSTRAINT "scheduled_event_hosts_scheduled_event_id_scheduled_events_id_fk" FOREIGN KEY ("scheduled_event_id") REFERENCES "public"."scheduled_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_event_hosts" ADD CONSTRAINT "scheduled_event_hosts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_event_hosts" ADD CONSTRAINT "scheduled_event_hosts_pool_id_event_type_host_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."event_type_host_pools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_events" ADD CONSTRAINT "scheduled_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_events" ADD CONSTRAINT "scheduled_events_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_events" ADD CONSTRAINT "scheduled_events_organizer_user_id_users_id_fk" FOREIGN KEY ("organizer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_events" ADD CONSTRAINT "scheduled_events_single_use_link_id_single_use_links_id_fk" FOREIGN KEY ("single_use_link_id") REFERENCES "public"."single_use_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_events" ADD CONSTRAINT "scheduled_events_one_off_meeting_id_one_off_meetings_id_fk" FOREIGN KEY ("one_off_meeting_id") REFERENCES "public"."one_off_meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_events" ADD CONSTRAINT "scheduled_events_poll_id_meeting_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."meeting_polls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_events" ADD CONSTRAINT "scheduled_events_rescheduled_from_event_id_scheduled_events_id_fk" FOREIGN KEY ("rescheduled_from_event_id") REFERENCES "public"."scheduled_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_shares" ADD CONSTRAINT "availability_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_shares" ADD CONSTRAINT "availability_shares_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_shares" ADD CONSTRAINT "availability_shares_single_use_link_id_single_use_links_id_fk" FOREIGN KEY ("single_use_link_id") REFERENCES "public"."single_use_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_meeting_spots" ADD CONSTRAINT "one_off_meeting_spots_one_off_meeting_id_one_off_meetings_id_fk" FOREIGN KEY ("one_off_meeting_id") REFERENCES "public"."one_off_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_meetings" ADD CONSTRAINT "one_off_meetings_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_meetings" ADD CONSTRAINT "one_off_meetings_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "single_use_links" ADD CONSTRAINT "single_use_links_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "single_use_links" ADD CONSTRAINT "single_use_links_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "single_use_links" ADD CONSTRAINT "single_use_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_poll_activity" ADD CONSTRAINT "meeting_poll_activity_poll_id_meeting_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."meeting_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_poll_comments" ADD CONSTRAINT "meeting_poll_comments_poll_id_meeting_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."meeting_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_poll_options" ADD CONSTRAINT "meeting_poll_options_poll_id_meeting_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."meeting_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_poll_participants" ADD CONSTRAINT "meeting_poll_participants_poll_id_meeting_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."meeting_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_poll_participants" ADD CONSTRAINT "meeting_poll_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_poll_votes" ADD CONSTRAINT "meeting_poll_votes_participant_id_meeting_poll_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."meeting_poll_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_poll_votes" ADD CONSTRAINT "meeting_poll_votes_option_id_meeting_poll_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."meeting_poll_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_polls" ADD CONSTRAINT "meeting_polls_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_polls" ADD CONSTRAINT "meeting_polls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_polls" ADD CONSTRAINT "meeting_polls_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_slug_redirects" ADD CONSTRAINT "poll_slug_redirects_poll_id_meeting_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."meeting_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event_types" ADD CONSTRAINT "workflow_event_types_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_event_types" ADD CONSTRAINT "workflow_event_types_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_step_id_workflow_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_scheduled_event_id_scheduled_events_id_fk" FOREIGN KEY ("scheduled_event_id") REFERENCES "public"."scheduled_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_invitee_id_invitees_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."invitees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_basic_event_type_id_event_types_id_fk" FOREIGN KEY ("basic_event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_form_permissions" ADD CONSTRAINT "routing_form_permissions_form_id_routing_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."routing_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_form_permissions" ADD CONSTRAINT "routing_form_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_form_questions" ADD CONSTRAINT "routing_form_questions_form_id_routing_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."routing_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_form_routes" ADD CONSTRAINT "routing_form_routes_form_id_routing_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."routing_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_form_submissions" ADD CONSTRAINT "routing_form_submissions_form_id_routing_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."routing_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_forms" ADD CONSTRAINT "routing_forms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_forms" ADD CONSTRAINT "routing_forms_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_custom_field_definitions" ADD CONSTRAINT "contact_custom_field_definitions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_custom_field_values" ADD CONSTRAINT "contact_custom_field_values_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_custom_field_values" ADD CONSTRAINT "contact_custom_field_values_definition_id_contact_custom_field_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."contact_custom_field_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_emails" ADD CONSTRAINT "contact_emails_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_list_id_contact_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."contact_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_lists" ADD CONSTRAINT "contact_lists_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_reminders" ADD CONSTRAINT "contact_reminders_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."webhook_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_coupons" ADD CONSTRAINT "event_type_coupons_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_coupons" ADD CONSTRAINT "event_type_coupons_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invitee_id_invitees_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."invitees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_scheduled_event_id_scheduled_events_id_fk" FOREIGN KEY ("scheduled_event_id") REFERENCES "public"."scheduled_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_booking_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."booking_reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_deletion_requests" ADD CONSTRAINT "data_deletion_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_hash_uq" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_idx" ON "auth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_provider_account_uq" ON "oauth_accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "oauth_user_idx" ON "oauth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rate_limit_window_idx" ON "rate_limit_buckets" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trusted_devices_token_uq" ON "trusted_devices" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "recovery_user_idx" ON "two_factor_recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email_normalized") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_slug_uq" ON "users" USING btree ("slug") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "users_avatar_file_idx" ON "users" USING btree ("avatar_file_id");--> statement-breakpoint
CREATE INDEX "users_logo_file_idx" ON "users" USING btree ("logo_file_id");--> statement-breakpoint
CREATE INDEX "users_destination_calendar_idx" ON "users" USING btree ("destination_calendar_id");--> statement-breakpoint
CREATE INDEX "users_created_via_invitation_idx" ON "users" USING btree ("created_via_invitation_id");--> statement-breakpoint
CREATE INDEX "verification_lookup_idx" ON "verification_codes" USING btree ("purpose","email_normalized","created_at");--> statement-breakpoint
CREATE INDEX "group_memberships_user_idx" ON "group_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "groups_org_idx" ON "groups" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "handles_user_uq" ON "handles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "handles_team_uq" ON "handles" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_invitation_token_uq" ON "organization_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "org_invitation_pending_uq" ON "organization_invitations" USING btree ("organization_id","email_normalized") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "org_invitation_org_idx" ON "organization_invitations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "org_invitation_inviter_idx" ON "organization_invitations" USING btree ("invited_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_membership_user_uq" ON "organization_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "org_membership_org_idx" ON "organization_memberships" USING btree ("organization_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "org_single_owner_uq" ON "organization_memberships" USING btree ("organization_id") WHERE role = 'owner';--> statement-breakpoint
CREATE INDEX "organizations_logo_file_idx" ON "organizations" USING btree ("logo_file_id");--> statement-breakpoint
CREATE INDEX "team_memberships_user_idx" ON "team_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_slug_uq" ON "teams" USING btree ("slug") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "teams_org_idx" ON "teams" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "teams_avatar_file_idx" ON "teams" USING btree ("avatar_file_id");--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "overrides_schedule_date_uq" ON "availability_date_overrides" USING btree ("schedule_id","date");--> statement-breakpoint
CREATE INDEX "schedules_user_idx" ON "availability_schedules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "schedules_event_type_idx" ON "availability_schedules" USING btree ("event_type_id");--> statement-breakpoint
CREATE INDEX "schedules_single_use_idx" ON "availability_schedules" USING btree ("single_use_link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedules_one_default_uq" ON "availability_schedules" USING btree ("user_id") WHERE is_default and event_type_id is null and single_use_link_id is null and deleted_at is null;--> statement-breakpoint
CREATE INDEX "pools_event_type_idx" ON "event_type_host_pools" USING btree ("event_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_type_hosts_uq" ON "event_type_hosts" USING btree ("event_type_id","user_id");--> statement-breakpoint
CREATE INDEX "event_type_hosts_user_idx" ON "event_type_hosts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "event_type_hosts_pool_idx" ON "event_type_hosts" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "event_type_hosts_schedule_idx" ON "event_type_hosts" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "event_type_permissions_user_idx" ON "event_type_permissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "questions_event_type_idx" ON "event_type_questions" USING btree ("event_type_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "event_types_user_slug_uq" ON "event_types" USING btree ("owner_user_id","slug") WHERE team_id is null and scope = 'personal' and type = 'standard' and deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "event_types_team_slug_uq" ON "event_types" USING btree ("team_id","slug") WHERE team_id is not null and deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "event_types_share_code_uq" ON "event_types" USING btree ("share_code") WHERE share_code is not null;--> statement-breakpoint
CREATE INDEX "event_types_owner_pos_idx" ON "event_types" USING btree ("owner_user_id","position");--> statement-breakpoint
CREATE INDEX "event_types_team_pos_idx" ON "event_types" USING btree ("team_id","position");--> statement-breakpoint
CREATE INDEX "event_types_org_idx" ON "event_types" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "event_types_schedule_idx" ON "event_types" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "event_types_destination_calendar_idx" ON "event_types" USING btree ("destination_calendar_id");--> statement-breakpoint
CREATE INDEX "event_types_organizer_idx" ON "event_types" USING btree ("organizer_user_id");--> statement-breakpoint
CREATE INDEX "event_types_managed_template_idx" ON "event_types" USING btree ("managed_template_id");--> statement-breakpoint
CREATE INDEX "managed_assign_template_idx" ON "managed_event_assignments" USING btree ("template_event_type_id");--> statement-breakpoint
CREATE INDEX "managed_assign_user_idx" ON "managed_event_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "managed_assign_team_idx" ON "managed_event_assignments" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "managed_assign_copy_idx" ON "managed_event_assignments" USING btree ("copy_event_type_id");--> statement-breakpoint
CREATE INDEX "cal_conn_user_idx" ON "calendar_connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cal_conn_account_uq" ON "calendar_connections" USING btree ("user_id","provider","provider_account_id") WHERE provider_account_id is not null and status <> 'disconnected';--> statement-breakpoint
CREATE INDEX "cal_conn_oauth_account_idx" ON "calendar_connections" USING btree ("oauth_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "linked_events_idem_uq" ON "calendar_linked_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "linked_events_event_idx" ON "calendar_linked_events" USING btree ("scheduled_event_id");--> statement-breakpoint
CREATE INDEX "linked_events_conn_status_idx" ON "calendar_linked_events" USING btree ("connection_id","status");--> statement-breakpoint
CREATE INDEX "linked_events_poll_idx" ON "calendar_linked_events" USING btree ("poll_id");--> statement-breakpoint
CREATE INDEX "linked_events_one_off_idx" ON "calendar_linked_events" USING btree ("one_off_meeting_id");--> statement-breakpoint
CREATE INDEX "linked_events_cal_ext_idx" ON "calendar_linked_events" USING btree ("calendar_id","external_id");--> statement-breakpoint
CREATE INDEX "linked_events_user_idx" ON "calendar_linked_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "linked_events_poll_option_idx" ON "calendar_linked_events" USING btree ("poll_option_id");--> statement-breakpoint
CREATE INDEX "linked_events_one_off_spot_idx" ON "calendar_linked_events" USING btree ("one_off_spot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_windows_uq" ON "calendar_sync_windows" USING btree ("calendar_id","window_start","window_end");--> statement-breakpoint
CREATE INDEX "sync_windows_fetched_idx" ON "calendar_sync_windows" USING btree ("calendar_id","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watch_channel_uq" ON "calendar_watch_channels" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "watch_channels_calendar_idx" ON "calendar_watch_channels" USING btree ("calendar_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendars_conn_ext_uq" ON "calendars" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "calendars_user_conflicts_idx" ON "calendars" USING btree ("user_id","check_conflicts");--> statement-breakpoint
CREATE UNIQUE INDEX "external_events_uq" ON "external_events" USING btree ("calendar_id","external_id","start_at");--> statement-breakpoint
CREATE INDEX "external_events_user_range_idx" ON "external_events" USING btree ("user_id","start_at","end_at");--> statement-breakpoint
CREATE INDEX "external_events_cal_start_idx" ON "external_events" USING btree ("calendar_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conf_conn_uq" ON "conferencing_connections" USING btree ("user_id","provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "conf_conn_user_idx" ON "conferencing_connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blocked_email_uq" ON "blocked_invitees" USING btree ("user_id","email_normalized") WHERE email_normalized is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "blocked_domain_uq" ON "blocked_invitees" USING btree ("user_id","domain") WHERE domain is not null;--> statement-breakpoint
CREATE INDEX "blocked_user_idx" ON "blocked_invitees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reservations_status_exp_idx" ON "booking_reservations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "reservations_type_start_idx" ON "booking_reservations" USING btree ("event_type_id","start_at");--> statement-breakpoint
CREATE INDEX "reservations_hosts_gin" ON "booking_reservations" USING gin ("host_user_ids") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "guests_invitee_idx" ON "invitee_guests" USING btree ("invitee_id");--> statement-breakpoint
CREATE INDEX "guests_event_idx" ON "invitee_guests" USING btree ("scheduled_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "no_shows_invitee_uq" ON "invitee_no_shows" USING btree ("invitee_id");--> statement-breakpoint
CREATE INDEX "invitees_event_idx" ON "invitees" USING btree ("scheduled_event_id");--> statement-breakpoint
CREATE INDEX "invitees_email_idx" ON "invitees" USING btree ("email_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "invitees_client_request_uq" ON "invitees" USING btree ("client_request_id") WHERE client_request_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "invitees_reservation_uq" ON "invitees" USING btree ("reservation_id") WHERE reservation_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "invitees_old_invitee_uq" ON "invitees" USING btree ("old_invitee_id") WHERE old_invitee_id is not null;--> statement-breakpoint
CREATE INDEX "invitees_new_invitee_idx" ON "invitees" USING btree ("new_invitee_id");--> statement-breakpoint
CREATE INDEX "invitees_org_created_idx" ON "invitees" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "invitees_type_created_idx" ON "invitees" USING btree ("event_type_id","created_at");--> statement-breakpoint
CREATE INDEX "invitees_contact_idx" ON "invitees" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "invitees_routing_idx" ON "invitees" USING btree ("routing_form_submission_id");--> statement-breakpoint
CREATE INDEX "invitees_poll_participant_idx" ON "invitees" USING btree ("poll_participant_id");--> statement-breakpoint
CREATE INDEX "meeting_activity_event_idx" ON "meeting_activity" USING btree ("scheduled_event_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sched_hosts_uq" ON "scheduled_event_hosts" USING btree ("scheduled_event_id","user_id");--> statement-breakpoint
CREATE INDEX "sched_hosts_busy_idx" ON "scheduled_event_hosts" USING btree ("user_id","is_active","buffered_start_at","buffered_end_at");--> statement-breakpoint
CREATE INDEX "sched_hosts_rr_idx" ON "scheduled_event_hosts" USING btree ("event_type_id","pool_id","user_id","assigned_at") WHERE role = 'assigned' and is_active;--> statement-breakpoint
CREATE INDEX "sched_hosts_pool_idx" ON "scheduled_event_hosts" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "sched_org_start_idx" ON "scheduled_events" USING btree ("organization_id","start_at");--> statement-breakpoint
CREATE INDEX "sched_type_start_idx" ON "scheduled_events" USING btree ("event_type_id","start_at");--> statement-breakpoint
CREATE INDEX "sched_organizer_start_idx" ON "scheduled_events" USING btree ("organizer_user_id","start_at");--> statement-breakpoint
CREATE INDEX "sched_poll_idx" ON "scheduled_events" USING btree ("poll_id");--> statement-breakpoint
CREATE INDEX "sched_single_use_idx" ON "scheduled_events" USING btree ("single_use_link_id");--> statement-breakpoint
CREATE INDEX "sched_one_off_idx" ON "scheduled_events" USING btree ("one_off_meeting_id");--> statement-breakpoint
CREATE INDEX "sched_rescheduled_from_idx" ON "scheduled_events" USING btree ("rescheduled_from_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sched_group_slot_uq" ON "scheduled_events" USING btree ("event_type_id","start_at") WHERE status = 'active' and is_group;--> statement-breakpoint
CREATE UNIQUE INDEX "sched_poll_active_uq" ON "scheduled_events" USING btree ("poll_id") WHERE status = 'active' and poll_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "sched_one_off_active_uq" ON "scheduled_events" USING btree ("one_off_meeting_id") WHERE status = 'active' and one_off_meeting_id is not null;--> statement-breakpoint
CREATE INDEX "shares_user_recipient_idx" ON "availability_shares" USING btree ("user_id","recipient_email_normalized");--> statement-breakpoint
CREATE INDEX "shares_event_type_idx" ON "availability_shares" USING btree ("event_type_id");--> statement-breakpoint
CREATE INDEX "shares_single_use_idx" ON "availability_shares" USING btree ("single_use_link_id");--> statement-breakpoint
CREATE INDEX "one_off_spots_idx" ON "one_off_meeting_spots" USING btree ("one_off_meeting_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_off_code_uq" ON "one_off_meetings" USING btree ("code");--> statement-breakpoint
CREATE INDEX "one_off_owner_status_idx" ON "one_off_meetings" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "one_off_event_type_idx" ON "one_off_meetings" USING btree ("event_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "single_use_code_uq" ON "single_use_links" USING btree ("code");--> statement-breakpoint
CREATE INDEX "single_use_owner_idx" ON "single_use_links" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "single_use_event_type_idx" ON "single_use_links" USING btree ("event_type_id");--> statement-breakpoint
CREATE INDEX "single_use_contact_idx" ON "single_use_links" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "poll_activity_idx" ON "meeting_poll_activity" USING btree ("poll_id","created_at");--> statement-breakpoint
CREATE INDEX "poll_comments_idx" ON "meeting_poll_comments" USING btree ("poll_id","created_at");--> statement-breakpoint
CREATE INDEX "poll_options_start_idx" ON "meeting_poll_options" USING btree ("poll_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "poll_options_unique_time_uq" ON "meeting_poll_options" USING btree ("poll_id","starts_at","ends_at") WHERE deleted_at is null and starts_at is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "poll_options_unique_day_uq" ON "meeting_poll_options" USING btree ("poll_id","all_day_date") WHERE deleted_at is null and all_day_date is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "poll_participant_email_uq" ON "meeting_poll_participants" USING btree ("poll_id","email_normalized") WHERE email_normalized is not null and deleted_at is null;--> statement-breakpoint
CREATE INDEX "poll_participants_status_idx" ON "meeting_poll_participants" USING btree ("poll_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "poll_participant_edit_uq" ON "meeting_poll_participants" USING btree ("edit_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "poll_participant_invite_uq" ON "meeting_poll_participants" USING btree ("invite_token_hash") WHERE invite_token_hash is not null;--> statement-breakpoint
CREATE INDEX "poll_participants_user_idx" ON "meeting_poll_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "poll_votes_count_idx" ON "meeting_poll_votes" USING btree ("poll_id","option_id","choice");--> statement-breakpoint
CREATE INDEX "poll_votes_option_idx" ON "meeting_poll_votes" USING btree ("option_id");--> statement-breakpoint
CREATE UNIQUE INDEX "polls_event_type_uq" ON "meeting_polls" USING btree ("event_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "polls_slug_uq" ON "meeting_polls" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "polls_owner_status_idx" ON "meeting_polls" USING btree ("owner_user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "polls_open_deadline_idx" ON "meeting_polls" USING btree ("status","deadline_at") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "polls_org_idx" ON "meeting_polls" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "poll_slug_redirects_poll_idx" ON "poll_slug_redirects" USING btree ("poll_id");--> statement-breakpoint
CREATE INDEX "workflow_event_types_et_idx" ON "workflow_event_types" USING btree ("event_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wf_exec_idem_uq" ON "workflow_executions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "wf_exec_event_idx" ON "workflow_executions" USING btree ("scheduled_event_id","status");--> statement-breakpoint
CREATE INDEX "wf_exec_workflow_idx" ON "workflow_executions" USING btree ("workflow_id","status");--> statement-breakpoint
CREATE INDEX "wf_exec_invitee_idx" ON "workflow_executions" USING btree ("invitee_id","status");--> statement-breakpoint
CREATE INDEX "wf_exec_due_idx" ON "workflow_executions" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "wf_exec_step_idx" ON "workflow_executions" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "workflow_steps_idx" ON "workflow_steps" USING btree ("workflow_id","position");--> statement-breakpoint
CREATE INDEX "workflows_owner_idx" ON "workflows" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "workflows_team_idx" ON "workflows" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_basic_uq" ON "workflows" USING btree ("basic_event_type_id","basic_kind","offset_minutes") WHERE is_basic and deleted_at is null;--> statement-breakpoint
CREATE INDEX "workflows_org_idx" ON "workflows" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workflows_basic_event_type_idx" ON "workflows" USING btree ("basic_event_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_idem_uq" ON "email_outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "email_outbox_status_idx" ON "email_outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "email_outbox_event_idx" ON "email_outbox" USING btree ("scheduled_event_id");--> statement-breakpoint
CREATE INDEX "email_outbox_invitee_idx" ON "email_outbox" USING btree ("invitee_id");--> statement-breakpoint
CREATE INDEX "email_outbox_user_idx" ON "email_outbox" USING btree ("related_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_idem_uq" ON "sms_messages" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "sms_status_idx" ON "sms_messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "domain_events_type_idx" ON "domain_events" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE INDEX "domain_events_org_idx" ON "domain_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("run_at","priority") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idem_uq" ON "jobs" USING btree ("idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE INDEX "jobs_group_idx" ON "jobs" USING btree ("group_key") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "jobs_type_status_idx" ON "jobs" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "jobs_stuck_idx" ON "jobs" USING btree ("locked_until") WHERE status = 'running';--> statement-breakpoint
CREATE INDEX "routing_form_permissions_user_idx" ON "routing_form_permissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "routing_questions_idx" ON "routing_form_questions" USING btree ("form_id","position");--> statement-breakpoint
CREATE INDEX "routing_routes_idx" ON "routing_form_routes" USING btree ("form_id","position");--> statement-breakpoint
CREATE INDEX "routing_submissions_idx" ON "routing_form_submissions" USING btree ("form_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "routing_forms_slug_uq" ON "routing_forms" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "routing_forms_org_idx" ON "routing_forms" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "routing_forms_owner_idx" ON "routing_forms" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "contact_field_defs_owner_idx" ON "contact_custom_field_definitions" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "contact_field_values_definition_idx" ON "contact_custom_field_values" USING btree ("definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_emails_owner_uq" ON "contact_emails" USING btree ("owner_user_id","email_normalized") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "contact_emails_contact_idx" ON "contact_emails" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_list_members_contact_idx" ON "contact_list_members" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_lists_owner_idx" ON "contact_lists" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "contact_notes_contact_idx" ON "contact_notes" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_notes_author_idx" ON "contact_notes" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "contact_reminders_due_idx" ON "contact_reminders" USING btree ("due_at") WHERE done_at is null;--> statement-breakpoint
CREATE INDEX "contact_reminders_contact_idx" ON "contact_reminders" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contacts_owner_name_idx" ON "contacts" USING btree ("owner_user_id","name");--> statement-breakpoint
CREATE INDEX "contacts_owner_last_idx" ON "contacts" USING btree ("owner_user_id","last_meeting_at");--> statement-breakpoint
CREATE INDEX "analytics_org_kind_idx" ON "analytics_events" USING btree ("organization_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "analytics_type_kind_idx" ON "analytics_events" USING btree ("event_type_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "analytics_user_kind_idx" ON "analytics_events" USING btree ("user_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_hash_uq" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_feeds_user_uq" ON "calendar_feeds" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_feeds_token_uq" ON "calendar_feeds" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "deliveries_sub_idx" ON "webhook_deliveries" USING btree ("subscription_id","created_at");--> statement-breakpoint
CREATE INDEX "deliveries_due_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_fanout_uq" ON "webhook_deliveries" USING btree ("subscription_id","domain_event_id","event") WHERE domain_event_id is not null and redelivery_of_id is null;--> statement-breakpoint
CREATE INDEX "webhooks_org_state_idx" ON "webhook_subscriptions" USING btree ("organization_id","state");--> statement-breakpoint
CREATE INDEX "webhooks_user_idx" ON "webhook_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "webhooks_group_idx" ON "webhook_subscriptions" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "webhooks_creator_idx" ON "webhook_subscriptions" USING btree ("creator_user_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_idx" ON "coupon_redemptions" USING btree ("coupon_id","invitee_email_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_uq" ON "coupons" USING btree ("owner_user_id","code_normalized") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "coupons_owner_idx" ON "coupons" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "event_type_coupons_coupon_idx" ON "event_type_coupons" USING btree ("coupon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_external_uq" ON "payments" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "payments_invitee_idx" ON "payments" USING btree ("invitee_id");--> statement-breakpoint
CREATE INDEX "payments_scheduled_event_idx" ON "payments" USING btree ("scheduled_event_id");--> statement-breakpoint
CREATE INDEX "payments_reservation_idx" ON "payments" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "payments_coupon_idx" ON "payments" USING btree ("coupon_id");--> statement-breakpoint
CREATE INDEX "audit_org_time_idx" ON "audit_log" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_ns_action_idx" ON "audit_log" USING btree ("namespace","action");--> statement-breakpoint
CREATE INDEX "data_deletion_org_idx" ON "data_deletion_requests" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_mappings_uq" ON "import_mappings" USING btree ("user_id","source","entity_type","external_id");--> statement-breakpoint
CREATE INDEX "import_runs_user_idx" ON "import_runs" USING btree ("user_id","created_at");