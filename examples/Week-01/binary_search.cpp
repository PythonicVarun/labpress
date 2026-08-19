#include <iostream>
#include <vector>
using namespace std;

// Classic iterative binary search over a sorted array.
int binarySearch(const vector<int> &a, int key) {
    int low = 0, high = a.size() - 1;
    while (low <= high) {
        int mid = low + (high - low) / 2;
        if (a[mid] == key) return mid;
        if (a[mid] < key)
            low = mid + 1;
        else
            high = mid - 1;
    }
    return -1;
}

int main() {
    int n;
    cout << "How many elements? ";
    cin >> n;

    vector<int> a(n);
    cout << "Enter " << n << " sorted values: ";
    for (int &value : a) cin >> value;

    int key;
    cout << "Key to search for: ";
    cin >> key;

    int index = binarySearch(a, key);
    if (index == -1)
        cout << key << " is not in the array.\n";
    else
        cout << key << " found at index " << index << ".\n";
    return 0;
}
