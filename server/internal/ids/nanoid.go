// Package ids makes the ids and tokens the app stores, as src/utils/server/nanoid.ts does.
package ids

import (
	"crypto/rand"
	"math/big"
)

// The "nolookalikes" alphabet from nanoid-dictionary: no characters that are easy to mistake for one another
const alphabet = "346789ABCDEFGHJKLMNPQRTUVWXYabcdefghijkmnpqrtwxyz"

const size = 10

// New is a random id of 10 characters from the alphabet above
func New() string {
	max := big.NewInt(int64(len(alphabet)))
	id := make([]byte, size)
	for i := range id {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			panic(err)
		}
		id[i] = alphabet[n.Int64()]
	}
	return string(id)
}
