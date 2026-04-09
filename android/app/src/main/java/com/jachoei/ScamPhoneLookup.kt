package com.jachoei

import android.database.sqlite.SQLiteDatabase

data class ScamPhoneLookupTrace(
    val originalInput: String,
    val digitsOnly: String,
    val canonical: String,
    val variants: List<String>,
    val rowsFound: Int,
    val matchingRowsByVariant: Map<String, List<Map<String, Any?>>>,
    val matchedVariant: String?,
    val matchedRow: Map<String, Any?>?,
    val matchedPhoneNormalized: String?,
    val localBlockedRaw: Int,
    val serverDeletedRaw: Int,
    val riskLevel: Int,
    val localBlocked: Boolean,
    val communitySpam: Boolean,
    val finalDecision: String,
    val finalReason: String,
)

object ScamPhoneLookup {
    fun empty(rawInput: String): ScamPhoneLookupTrace {
        val ctx = PhoneUtils.buildMatchContext(rawInput)
        return ScamPhoneLookupTrace(
            originalInput = ctx.originalInput,
            digitsOnly = ctx.digitsOnly,
            canonical = ctx.canonical,
            variants = ctx.variants.toList(),
            rowsFound = 0,
            matchingRowsByVariant = ctx.variants.associateWith { emptyList() },
            matchedVariant = null,
            matchedRow = null,
            matchedPhoneNormalized = null,
            localBlockedRaw = 0,
            serverDeletedRaw = 0,
            riskLevel = 0,
            localBlocked = false,
            communitySpam = false,
            finalDecision = "ALLOW",
            finalReason = if (ctx.canonical.isBlank()) "empty_input" else "no_match",
        )
    }

    fun lookup(
        db: SQLiteDatabase,
        table: String,
        rawInput: String,
        spamWarnRiskThreshold: Int,
    ): ScamPhoneLookupTrace {
        val ctx = PhoneUtils.buildMatchContext(rawInput)
        val variants = ctx.variants.toList()
        if (ctx.canonical.isBlank() || variants.isEmpty()) {
            return empty(rawInput)
        }

        val matchingRows = LinkedHashMap<String, MutableList<Map<String, Any?>>>()
        for (variant in variants) {
            matchingRows[variant] = mutableListOf()
        }

        val placeholders = variants.joinToString(",") { "?" }
        val sql = """
            SELECT id, phone_normalized, local_blocked, risk_level, server_deleted, report_count, last_report_at, tags, server_updated_at
            FROM $table
            WHERE phone_normalized IN ($placeholders)
            ORDER BY local_blocked DESC, risk_level DESC, server_deleted ASC, phone_normalized ASC
            """.trimIndent()

        val rows = ArrayList<Map<String, Any?>>()
        db.rawQuery(sql, variants.toTypedArray()).use { c ->
            while (c.moveToNext()) {
                val row = linkedMapOf<String, Any?>(
                    "id" to if (!c.isNull(0)) c.getInt(0) else null,
                    "phone_normalized" to if (!c.isNull(1)) c.getString(1) else null,
                    "local_blocked" to if (!c.isNull(2)) c.getInt(2) else null,
                    "risk_level" to if (!c.isNull(3)) c.getInt(3) else null,
                    "server_deleted" to if (!c.isNull(4)) c.getInt(4) else null,
                    "report_count" to if (!c.isNull(5)) c.getInt(5) else null,
                    "last_report_at" to if (!c.isNull(6)) c.getString(6) else null,
                    "tags" to if (!c.isNull(7)) c.getString(7) else null,
                    "server_updated_at" to if (!c.isNull(8)) c.getString(8) else null,
                    "phone_canonical" to ctx.canonical,
                )
                rows.add(row)
                val matchedVariant = row["phone_normalized"] as? String
                if (!matchedVariant.isNullOrBlank()) {
                    matchingRows.getOrPut(matchedVariant) { mutableListOf() }.add(row)
                }
            }
        }

        val best = rows.firstOrNull()
        val matchedVariant = best?.get("phone_normalized") as? String
        val localBlockedRaw = (best?.get("local_blocked") as? Int) ?: 0
        val serverDeletedRaw = (best?.get("server_deleted") as? Int) ?: 0
        val riskLevel = (best?.get("risk_level") as? Int) ?: 0
        val localBlocked = localBlockedRaw == 1
        val communitySpam = best != null && !localBlocked && serverDeletedRaw == 0 && riskLevel >= spamWarnRiskThreshold
        val finalDecision = when {
            best == null -> "ALLOW"
            localBlocked -> "BLOCK"
            communitySpam -> "WARN"
            else -> "ALLOW"
        }
        val finalReason = when {
            best == null -> "no_match"
            localBlocked -> "local_blocked"
            communitySpam -> "community_spam_warn_only"
            else -> "not_blocked"
        }

        return ScamPhoneLookupTrace(
            originalInput = ctx.originalInput,
            digitsOnly = ctx.digitsOnly,
            canonical = ctx.canonical,
            variants = variants,
            rowsFound = rows.size,
            matchingRowsByVariant = matchingRows,
            matchedVariant = matchedVariant,
            matchedRow = best,
            matchedPhoneNormalized = matchedVariant,
            localBlockedRaw = localBlockedRaw,
            serverDeletedRaw = serverDeletedRaw,
            riskLevel = riskLevel,
            localBlocked = localBlocked,
            communitySpam = communitySpam,
            finalDecision = finalDecision,
            finalReason = finalReason,
        )
    }
}