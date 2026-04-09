package com.jachoei

object PhoneUtils {

    data class PhoneMatchContext(
        val originalInput: String,
        val digitsOnly: String,
        val canonical: String,
        val variants: Array<String>,
    )

    /** Digits-only form (no spaces/dashes/parentheses/+). */
    fun digitsOnly(raw: String?): String {
        if (raw.isNullOrBlank()) return ""
        return raw.trim().replace(Regex("[^\\d]"), "")
    }

    fun buildMatchContext(raw: String?): PhoneMatchContext {
        val original = raw?.trim().orEmpty()
        val digits = digitsOnly(raw)
        val canonical = canonicalFromDigits(digits)
        val variants = buildVariants(canonical, digits)
        return PhoneMatchContext(
            originalInput = original,
            digitsOnly = digits,
            canonical = canonical,
            variants = variants,
        )
    }

    private fun canonicalFromDigits(digits0: String): String {
        if (digits0.isEmpty()) return ""
        return if (digits0.startsWith("0") && digits0.length == 10) {
            "66" + digits0.substring(1)
        } else {
            digits0
        }
    }

    private fun buildVariants(canonical: String, digitsOnly: String): Array<String> {
        if (canonical.isEmpty() && digitsOnly.isEmpty()) return emptyArray()

        val out = LinkedHashSet<String>()
        if (canonical.isNotEmpty()) {
            out.add(canonical)
            if (canonical.startsWith("66") && canonical.length == 11) {
                out.add("0" + canonical.substring(2))
                out.add("+" + canonical)
            }
        }
        if (digitsOnly.isNotEmpty()) {
            out.add(digitsOnly)
        }
        return out.toTypedArray()
    }

    /**
     * Canonical phone key: digits only.
     * Thai: 0xxxxxxxxx (10) -> 66xxxxxxxxx (11)
     */
    fun normalize(raw: String?): String {
        return buildMatchContext(raw).canonical
    }

    /**
     * Generate exact match variants for legacy/local formats.
     * Helps when older rows were stored as +66... or 0...
     */
    fun variants(canonical: String): Array<String> {
        val c = normalize(canonical)
        return buildVariants(c, digitsOnly(canonical))
    }

    /**
     * Generate match variants directly from raw input.
     * Includes digits-only, canonical, and legacy Thai formats (+66 / 0 / 066), plus 00-prefixed forms.
     */
    fun variantsFromRaw(raw: String?): Array<String> {
        return buildMatchContext(raw).variants
    }
}
