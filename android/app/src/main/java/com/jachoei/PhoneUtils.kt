package com.jachoei

object PhoneUtils {

    /**
     * Canonical phone key: digits only.
     * Thai: 0xxxxxxxxx (10) -> 66xxxxxxxxx (11)
     */
    fun normalize(raw: String?): String {
        if (raw.isNullOrBlank()) return ""
        val digits = raw.trim().replace(Regex("[^\\d]"), "")
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
}
