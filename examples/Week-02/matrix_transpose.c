#include <stdio.h>

#define MAX 10

int main(void) {
    int rows, cols;
    printf("Rows and columns: ");
    scanf("%d %d", &rows, &cols);

    int m[MAX][MAX];
    printf("Enter the matrix row by row:\n");
    for (int i = 0; i < rows; i++)
        for (int j = 0; j < cols; j++) scanf("%d", &m[i][j]);

    printf("\nTranspose:\n");
    for (int j = 0; j < cols; j++) {
        for (int i = 0; i < rows; i++) printf("%4d", m[i][j]);
        printf("\n");
    }
    return 0;
}
