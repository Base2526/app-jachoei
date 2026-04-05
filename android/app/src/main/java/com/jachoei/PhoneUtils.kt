package com.jachoei

object PhoneUtils {

    /** Digits-only form (no spaces/dashes/parentheses/+). */
    fun digitsOnly(raw: String?): String {
        if (raw.isNullOrBlank()) return ""
        return raw.trim().replace(Regex("[^\\d]"), "")
    }

    /**
     * Canonical phone key: digits only.
     * Thai: 0xxxxxxxxx (10) -> 66xxxxxxxxx (11)
     */
    fun normalize(raw: String?): String {
        val digits0 = digitsOnly(raw)
        if (digits0.isEmpty()) return ""

        // Handle international prefix like 0066xxxxxxxxx
        val digits = if (digits0.startsWith("00") && digits0.length > 2) digits0.substring(2) else digits0
        if (digits.isEmpty()) return ""

        return if (digits.startsWith("0") && digits.length == 10) {
            "66" + digits.substring(1)
        } else {
            digits
        }
    }

    /**
     * Generate exact match variants for legacy/local formats.
     * Helps when older rows were stored as +66... or 0...
     */
    fun variants(canonical: String): Array<String> {
        val c = normalize(canonical)
        if (c.isEmpty()) return emptyArray()

        val out = LinkedHashSet<String>()
        out.add(c)

        // Thai mobile: 66 + 9 digits => 11 digits
        if (c.startsWith("66") && c.length == 11) {
            out.add("+" + c)                // +66xxxxxxxxx
            out.add("0" + c.substring(2))   // 0xxxxxxxxx
            out.add("066" + c.substring(2)) // 066xxxxxxxxx (legacy/typo formats)
        }

        return out.toTypedArray()
    }

    /**
     * Generate match variants directly from raw input.
     * Includes digits-only, canonical, and legacy Thai formats (+66 / 0 / 066), plus 00-prefixed forms.
     */
    fun variantsFromRaw(raw: String?): Array<String> {
        val out = LinkedHashSet<String>()

        val digits0 = digitsOnly(raw)
        if (digits0.isNotEmpty()) out.add(digits0)

        if (digits0.startsWith("00") && digits0.length > 2) {
            val no00 = digits0.substring(2)
            if (no00.isNotEmpty()) {
                out.add(no00)
                val canonNo00 = normalize(no00)
                if (canonNo00.isNotEmpty()) {
                    out.add(canonNo00)
                    for (v in variants(canonNo00)) out.add(v)
                }
            }
        }

        val canon = normalize(digits0)
        if (canon.isNotEmpty()) {
            out.add(canon)
            for (v in variants(canon)) out.add(v)
        }

        return out.toTypedArray()
    }
}
